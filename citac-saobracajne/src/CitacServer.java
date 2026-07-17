import com.sun.net.httpserver.*;
import javax.smartcardio.*;
import java.io.*;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.*;

/**
 * Karton — lokalni helper za čitač saobraćajne dozvole.
 * Sluša ISKLJUČIVO na 127.0.0.1; prihvata samo dozvoljene Origin-e (CORS).
 * GET /status — stanje čitača/kartice; GET /read — pročita karticu i vrati JSON.
 * Pokretanje: java CitacServer.java  (opciono: prvi argument = dodatni Origin, npr. https://servis.rs)
 * Reader logika: Baš Čelik (ubavic/bas-celik, AGPL).
 */
public class CitacServer {
  static final int PORT = 8765;
  /**
   * Sajtovi kojima helper sme da odgovori. Bez ovoga bi bilo koja stranica sa interneta
   * mogla da čita saobraćajne dok je čitač uključen — zato spisak, a ne „svima".
   *
   * PRODUKCIJSKI DOMEN JE OVDE UGRAĐEN NAMERNO. Ranije se dodavao samo ako se prosledi kao
   * argument, a `pokreni.bat` ga nije prosleđivao — pa je helper odbijao živi sajt (403) na
   * SVAKOM računaru. Aplikacija je pri tom prijavljivala „Čitač nije pokrenut", iako je radio.
   * Domen se ne sme oslanjati na to da se neko seti argumenta.
   */
  static final Set<String> ALLOWED = new HashSet<>(Arrays.asList(
    "https://autoserviss23.rs", "https://www.autoserviss23.rs",
    "http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000"));

  public static void main(String[] args) throws Exception {
    if (args.length > 0 && !args[0].isBlank()) ALLOWED.add(args[0].trim());
    HttpServer srv = HttpServer.create(new InetSocketAddress("127.0.0.1", PORT), 0);
    srv.createContext("/status", ex -> handle(ex, () -> statusJson()));
    srv.createContext("/read", ex -> handle(ex, () -> readVehicle()));
    srv.setExecutor(null);
    srv.start();
    System.out.println("Karton čitač saobraćajne — sluša na http://127.0.0.1:" + PORT);
    System.out.println("Dozvoljeni Origin-i: " + ALLOWED);
  }

  interface Job { String run() throws Exception; }

  static void handle(HttpExchange ex, Job job) throws IOException {
    String origin = ex.getRequestHeaders().getFirst("Origin");
    boolean dozvoljen = origin != null && ALLOWED.contains(origin);
    if (dozvoljen) {
      ex.getResponseHeaders().add("Access-Control-Allow-Origin", origin);
      ex.getResponseHeaders().add("Vary", "Origin");
      /*
       * Chrome poziv sa JAVNOG sajta ka 127.0.0.1 tretira kao „Private Network Access":
       * traži preflight i ovo zaglavlje, inače blokira zahtev pre nego što uopšte stigne
       * do nas. Bez ovoga bi radilo na jednom, a na drugom računaru ne — zavisno od verzije
       * Chrome-a. Šalje se samo dozvoljenim sajtovima, uz Allow-Origin.
       */
      ex.getResponseHeaders().add("Access-Control-Allow-Private-Network", "true");
    }
    if ("OPTIONS".equals(ex.getRequestMethod())) {
      if (dozvoljen) {
        ex.getResponseHeaders().add("Access-Control-Allow-Methods", "GET, OPTIONS");
        ex.getResponseHeaders().add("Access-Control-Allow-Headers", "Content-Type");
        ex.getResponseHeaders().add("Access-Control-Max-Age", "600");
      }
      ex.sendResponseHeaders(204, -1); ex.close(); return;
    }
    // Bez dozvoljenog Origin-a odbij (browser bi ionako blokirao odgovor)
    if (origin != null && !dozvoljen) { send(ex, 403, "{\"error\":\"origin nije dozvoljen\"}"); return; }
    ex.getResponseHeaders().add("Content-Type", "application/json; charset=utf-8");
    try { send(ex, 200, job.run()); }
    catch (Exception e) { send(ex, 200, "{\"error\":\"" + jesc(e.getMessage() == null ? "greška" : e.getMessage()) + "\"}"); }
  }
  static void send(HttpExchange ex, int code, String body) throws IOException {
    byte[] b = body.getBytes(StandardCharsets.UTF_8);
    ex.sendResponseHeaders(code, b.length);
    try (OutputStream os = ex.getResponseBody()) { os.write(b); }
  }

  /**
   * SunPCSC kešira PC/SC kontekst. Ako je JVM startovana bez priključenog čitača,
   * `list()` trajno baca SCARD_E_NO_READERS_AVAILABLE i kad se čitač kasnije priključi.
   * Zato pri neuspehu resetujemo kontekst refleksijom i probamo ponovo.
   * Zahteva: --add-opens java.smartcardio/sun.security.smartcardio=ALL-UNNAMED
   */
  static void resetPcscContext() throws Exception {
    Class<?> termCls = Class.forName("sun.security.smartcardio.PCSCTerminals");
    java.lang.reflect.Field ctx = termCls.getDeclaredField("contextId");
    ctx.setAccessible(true);
    Class<?> pcsc = Class.forName("sun.security.smartcardio.PCSC");
    java.lang.reflect.Method establish = pcsc.getDeclaredMethod("SCardEstablishContext", int.class);
    establish.setAccessible(true);
    java.lang.reflect.Field scope = pcsc.getDeclaredField("SCARD_SCOPE_USER");
    scope.setAccessible(true);
    long newCtx = (Long) establish.invoke(null, scope.getInt(null));
    ctx.setLong(null, newCtx);
  }

  /** Lista čitača; pri neuspehu jednom resetuje PC/SC kontekst i pokuša ponovo. */
  static List<CardTerminal> terminals() throws Exception {
    try {
      List<CardTerminal> l = TerminalFactory.getDefault().terminals().list();
      if (!l.isEmpty()) return l;
    } catch (Exception ignore) { /* pada niže na reset */ }
    try {
      resetPcscContext();
      List<CardTerminal> l = TerminalFactory.getDefault().terminals().list();
      if (!l.isEmpty()) return l;
    } catch (Exception ignore) { /* i dalje ništa */ }
    throw new Exception("Nema priključenog čitača.");
  }

  static String statusJson() throws Exception {
    boolean present = false; String reader = "";
    for (CardTerminal t : terminals()) { reader = t.getName(); if (t.isCardPresent()) { present = true; break; } }
    if (reader.isEmpty()) throw new Exception("Nema priključenog čitača.");
    return "{\"reader\":\"" + jesc(reader) + "\",\"cardPresent\":" + present + "}";
  }

  // ================== BER-TLV + čitanje kartice (Baš Čelik algoritam) ==================
  static class Node { int tag; boolean constructed; byte[] value; List<Node> children = new ArrayList<>(); }
  static int[] parseTag(byte[] d, int p) {
    int b0 = d[p] & 0xFF; int prim = (b0 & 0x20) == 0 ? 1 : 0;
    if ((b0 & 0x1F) != 0x1F) return new int[]{ b0, 1, prim };
    int b1 = d[p + 1] & 0xFF;
    if ((b1 & 0x80) == 0) return new int[]{ (b0 << 8) | b1, 2, prim };
    int b2 = d[p + 2] & 0xFF; return new int[]{ (b0 << 16) | (b1 << 8) | b2, 3, prim };
  }
  static int[] parseLen(byte[] d, int p) {
    int f = d[p] & 0xFF;
    if (f < 0x80) return new int[]{ f, 1 };
    if (f == 0x81) return new int[]{ d[p + 1] & 0xFF, 2 };
    if (f == 0x82) return new int[]{ ((d[p + 1] & 0xFF) << 8) | (d[p + 2] & 0xFF), 3 };
    if (f == 0x83) return new int[]{ ((d[p + 1] & 0xFF) << 16) | ((d[p + 2] & 0xFF) << 8) | (d[p + 3] & 0xFF), 4 };
    return new int[]{ 0, 1 };
  }
  static List<Node> parse(byte[] d) {
    List<Node> out = new ArrayList<>(); int p = 0;
    while (p < d.length) {
      if ((d[p] & 0xFF) == 0x00 || (d[p] & 0xFF) == 0xFF) { p++; continue; }
      int[] t = parseTag(d, p); p += t[1]; if (p >= d.length) break;
      int[] l = parseLen(d, p); p += l[1]; int len = l[0];
      if (p + len > d.length) len = d.length - p;
      byte[] val = Arrays.copyOfRange(d, p, p + len); p += len;
      Node n = new Node(); n.tag = t[0]; n.constructed = t[2] == 0; n.value = val;
      if (n.constructed) n.children = parse(val);
      out.add(n);
    }
    return out;
  }
  static Map<Integer, Node> merge(List<Node> nodes) {
    LinkedHashMap<Integer, Node> m = new LinkedHashMap<>();
    for (Node n : nodes) {
      Node e = m.get(n.tag);
      if (e == null) { Node c = new Node(); c.tag = n.tag; c.constructed = n.constructed; c.value = n.value; c.children = new ArrayList<>(n.children); m.put(n.tag, c); }
      else if (e.constructed && n.constructed) e.children.addAll(n.children);
    }
    return m;
  }
  static String access(List<Node> nodes, int... path) {
    Map<Integer, Node> m = merge(nodes); Node n = m.get(path[0]);
    if (n == null) return "";
    if (path.length == 1) return n.constructed ? "" : new String(n.value, StandardCharsets.UTF_8).trim();
    return access(n.children, Arrays.copyOfRange(path, 1, path.length));
  }
  static boolean ok(ResponseAPDU r) { return r.getSW() == 0x9000; }
  static byte[] tb(int[] a) { byte[] b = new byte[a.length]; for (int i = 0; i < a.length; i++) b[i] = (byte) a[i]; return b; }
  static void initCard(CardChannel ch) throws Exception {
    int[][][] seqs = {
      { {0xA0,0x00,0x00,0x01,0x51,0x00,0x00},
        {0xA0,0x00,0x00,0x00,0x77,0x01,0x08,0x00,0x07,0x00,0x00,0xFE,0x00,0x00,0x01,0x00},
        {0xA0,0x00,0x00,0x00,0x77,0x01,0x08,0x00,0x07,0x00,0x00,0xFE,0x00,0x00,0xAD,0xF2} },
      { {0xA0,0x00,0x00,0x00,0x03,0x00,0x00,0x00},
        {0xF3,0x81,0x00,0x00,0x02,0x53,0x45,0x52,0x56,0x4C,0x04,0x02,0x01},
        {0xA0,0x00,0x00,0x00,0x77,0x01,0x08,0x00,0x07,0x00,0x00,0xFE,0x00,0x00,0xAD,0xF2} },
      { {0xA0,0x00,0x00,0x00,0x18,0x43,0x4D,0x00},
        {0xA0,0x00,0x00,0x00,0x18,0x34,0x14,0x01,0x00,0x65,0x56,0x4C,0x2D,0x30,0x30,0x31},
        {0xA0,0x00,0x00,0x00,0x18,0x65,0x56,0x4C,0x2D,0x30,0x30,0x31} },
    };
    for (int[][] s : seqs) {
      try {
        if (!ok(ch.transmit(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, tb(s[0]))))) continue;
        ch.transmit(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, tb(s[1])));
        ch.transmit(new CommandAPDU(0x00, 0xA4, 0x04, 0x0C, tb(s[2])));
        return;
      } catch (Exception ignore) {}
    }
    throw new Exception("Kartica ne reaguje (nije saobraćajna?).");
  }
  static byte[] readBinary(CardChannel ch, int off, int len) throws Exception {
    return ch.transmit(new CommandAPDU(0x00, 0xB0, (off >> 8) & 0xFF, off & 0xFF, Math.min(len, 0xFF))).getData();
  }
  static byte[] readFile(CardChannel ch, int[] name) throws Exception {
    if (!ok(ch.transmit(new CommandAPDU(0x00, 0xA4, 0x02, 0x04, tb(name))))) throw new Exception("select file");
    byte[] h = readBinary(ch, 0, 0x20);
    int off = (h[1] & 0xFF) + 2;
    int[] tg = parseTag(h, off); int[] ln = parseLen(h, off + tg[1]);
    int len = ln[0] + tg[1] + ln[1];
    ByteArrayOutputStream out = new ByteArrayOutputStream();
    while (len > 0) { byte[] d = readBinary(ch, off, Math.min(len, 0x64)); if (d.length == 0) break; out.write(d); off += d.length; len -= d.length; }
    return out.toByteArray();
  }
  static String jesc(String s) { return s == null ? "" : s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").trim(); }

  static String readVehicle() throws Exception {
    CardTerminal term = null;
    for (CardTerminal t : terminals()) if (t.isCardPresent()) { term = t; break; }
    if (term == null) throw new Exception("Nema kartice u čitaču.");
    Card card = term.connect("*");
    try {
      CardChannel ch = card.getBasicChannel();
      initCard(ch);
      List<Node> all = new ArrayList<>();
      for (int[] name : new int[][]{ {0xD0,0x01}, {0xD0,0x11}, {0xD0,0x21}, {0xD0,0x31} }) all.addAll(parse(readFile(ch, name)));
      String own = (access(all, 0x71,0xA1,0xA2,0x84) + " " + access(all, 0x71,0xA1,0xA2,0x83)).trim();
      return "{" +
        "\"vin\":\"" + jesc(access(all, 0x71,0x8A)) + "\"," +
        "\"make\":\"" + jesc(access(all, 0x71,0xA3,0x87)) + "\"," +
        "\"model\":\"" + jesc(access(all, 0x71,0xA3,0x89)) + "\"," +
        "\"fuel\":\"" + jesc(access(all, 0x71,0xA5,0x92)) + "\"," +
        "\"year\":\"" + jesc(access(all, 0x72,0xC5)) + "\"," +
        "\"plate\":\"" + jesc(access(all, 0x71,0x81)) + "\"," +
        "\"ownerName\":\"" + jesc(own) + "\"," +
        "\"ownerAddress\":\"" + jesc(access(all, 0x71,0xA1,0xA2,0x85)) + "\"}";
    } finally { card.disconnect(false); }
  }
}
