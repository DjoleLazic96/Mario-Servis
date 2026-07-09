import javax.smartcardio.*;
import java.util.List;
public class Probe {
  public static void main(String[] a) throws Exception {
    TerminalFactory f = TerminalFactory.getDefault();
    List<CardTerminal> terms = f.terminals().list();
    System.out.println("Čitača: " + terms.size());
    for (CardTerminal t : terms) {
      System.out.println("  Čitač: " + t.getName() + " | kartica prisutna: " + t.isCardPresent());
      if (t.isCardPresent()) {
        Card card = t.connect("*");
        byte[] atr = card.getATR().getBytes();
        StringBuilder sb = new StringBuilder();
        for (byte b : atr) sb.append(String.format("%02X ", b));
        System.out.println("  ATR: " + sb.toString().trim());
        card.disconnect(false);
      }
    }
  }
}
