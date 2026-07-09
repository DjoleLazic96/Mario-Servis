import javax.smartcardio.*;
import java.util.*;
import java.nio.charset.StandardCharsets;

/**
 * Čita srpsku saobraćajnu dozvolu (MTCOS/Gemalto kartica) preko PC/SC.
 * Algoritam (SELECT sekvence, čitanje 4 fajla D0 01/11/21/31, BER-TLV,
 * mapiranje tagova) preuzet iz open-source Baš Čelik (ubavic/bas-celik, AGPL).
 */
public class ReadCard {

  // ---- BER-TLV ----
  static class Node { int tag; boolean constructed; byte[] value; List<Node> children = new ArrayList<>(); }

  static int[] parseTag(byte[] d, int p) { // vraća {tag, len, primitive(1/0)}
    int b0 = d[p] & 0xFF;
    int primitive = (b0 & 0x20) == 0 ? 1 : 0;
    if ((b0 & 0x1F) != 0x1F) return new int[]{ b0, 1, primitive };
    int b1 = d[p + 1] & 0xFF;
    if ((b1 & 0x80) == 0) return new int[]{ (b0 << 8) | b1, 2, primitive };
    int b2 = d[p + 2] & 0xFF;
    return new int[]{ (b0 << 16) | (b1 << 8) | b2, 3, primitive };
  }
  static int[] parseLen(byte[] d, int p) { // vraća {length, offset}
    int f = d[p] & 0xFF;
    if (f < 0x80) return new int[]{ f, 1 };
    if (f == 0x81) return new int[]{ d[p + 1] & 0xFF, 2 };
    if (f == 0x82) return new int[]{ ((d[p + 1] & 0xFF) << 8) | (d[p + 2] & 0xFF), 3 };
    if (f == 0x83) return new int[]{ ((d[p + 1] & 0xFF) << 16) | ((d[p + 2] & 0xFF) << 8) | (d[p + 3] & 0xFF), 4 };
    return new int[]{ 0, 1 };
  }
  static List<Node> parse(byte[] d) {
    List<Node> out = new ArrayList<>();
    int p = 0;
    while (p < d.length) {
      if ((d[p] & 0xFF) == 0x00 || (d[p] & 0xFF) == 0xFF) { p++; continue; }
      int[] t = parseTag(d, p); p += t[1];
      if (p >= d.length) break;
      int[] l = parseLen(d, p); p += l[1];
      int len = l[0];
      if (p + len > d.length) len = d.length - p;
      byte[] val = Arrays.copyOfRange(d, p, p + len);
      p += len;
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
    Map<Integer, Node> m = merge(nodes);
    Node n = m.get(path[0]);
    if (n == null) return "";
    if (path.length == 1) return n.constructed ? "" : new String(n.value, StandardCharsets.UTF_8).trim();
    return access(n.children, Arrays.copyOfRange(path, 1, path.length));
  }

  // ---- APDU / kartica ----
  static boolean ok(ResponseAPDU r) { return r.getSW() == 0x9000; }

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
        if (!ok(ch.transmit(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, toBytes(s[0]))))) continue;
        ch.transmit(new CommandAPDU(0x00, 0xA4, 0x04, 0x00, toBytes(s[1])));
        ch.transmit(new CommandAPDU(0x00, 0xA4, 0x04, 0x0C, toBytes(s[2])));
        return;
      } catch (Exception ignore) {}
    }
    throw new Exception("Kartica ne reaguje (nije saobraćajna?).");
  }
  static byte[] readBinary(CardChannel ch, int offset, int length) throws Exception {
    int rs = Math.min(length, 0xFF);
    ResponseAPDU r = ch.transmit(new CommandAPDU(0x00, 0xB0, (offset >> 8) & 0xFF, offset & 0xFF, rs));
    return r.getData();
  }
  static byte[] readFile(CardChannel ch, int[] name) throws Exception {
    if (!ok(ch.transmit(new CommandAPDU(0x00, 0xA4, 0x02, 0x04, toBytes(name))))) throw new Exception("select file");
    byte[] header = readBinary(ch, 0, 0x20);
    int offset = (header[1] & 0xFF) + 2;
    int[] tg = parseTag(header, offset);
    int[] ln = parseLen(header, offset + tg[1]);
    int length = ln[0] + tg[1] + ln[1];
    java.io.ByteArrayOutputStream out = new java.io.ByteArrayOutputStream();
    while (length > 0) {
      byte[] data = readBinary(ch, offset, Math.min(length, 0x64));
      if (data.length == 0) break;
      out.write(data); offset += data.length; length -= data.length;
    }
    return out.toByteArray();
  }
  static byte[] toBytes(int[] a) { byte[] b = new byte[a.length]; for (int i = 0; i < a.length; i++) b[i] = (byte) a[i]; return b; }
  static String jesc(String s) { return s.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", " ").trim(); }

  /** Pročita karticu i vrati JSON polja za formu vozila. */
  public static String readVehicle() throws Exception {
    TerminalFactory f = TerminalFactory.getDefault();
    List<CardTerminal> terms = f.terminals().list();
    if (terms.isEmpty()) throw new Exception("Nema priključenog čitača.");
    CardTerminal term = null;
    for (CardTerminal t : terms) if (t.isCardPresent()) { term = t; break; }
    if (term == null) throw new Exception("Nema kartice u čitaču.");
    Card card = term.connect("*");
    try {
      CardChannel ch = card.getBasicChannel();
      initCard(ch);
      List<Node> all = new ArrayList<>();
      int[][] files = { {0xD0, 0x01}, {0xD0, 0x11}, {0xD0, 0x21}, {0xD0, 0x31} };
      for (int[] name : files) all.addAll(parse(readFile(ch, name)));

      String vin = access(all, 0x71, 0x8A);
      String make = access(all, 0x71, 0xA3, 0x87);
      String model = access(all, 0x71, 0xA3, 0x89);
      String fuel = access(all, 0x71, 0xA5, 0x92);
      String year = access(all, 0x72, 0xC5);
      String plate = access(all, 0x71, 0x81);
      String ownSurname = access(all, 0x71, 0xA1, 0xA2, 0x83);
      String ownName = access(all, 0x71, 0xA1, 0xA2, 0x84);
      String ownAddr = access(all, 0x71, 0xA1, 0xA2, 0x85);

      return "{" +
        "\"vin\":\"" + jesc(vin) + "\"," +
        "\"make\":\"" + jesc(make) + "\"," +
        "\"model\":\"" + jesc(model) + "\"," +
        "\"fuel\":\"" + jesc(fuel) + "\"," +
        "\"year\":\"" + jesc(year) + "\"," +
        "\"plate\":\"" + jesc(plate) + "\"," +
        "\"ownerName\":\"" + jesc((ownName + " " + ownSurname).trim()) + "\"," +
        "\"ownerAddress\":\"" + jesc(ownAddr) + "\"}";
    } finally { card.disconnect(false); }
  }

  public static void main(String[] a) throws Exception {
    System.out.println(readVehicle());
  }
}
