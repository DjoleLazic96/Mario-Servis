// AUTO SERVIS S23 — čitač saobraćajne dozvole (jedan mali .exe, bez Jave).
//
// Sluša ISKLJUČIVO na 127.0.0.1:8765 i odgovara samo sajtovima sa spiska (CORS).
// GET /status → stanje čitača/kartice; GET /read → pročita karticu i vrati JSON.
//
// Logika čitanja srpske saobraćajne (SELECT sekvence, redosled fajlova, BER-TLV mapiranje)
// preuzeta je iz Java verzije ovog helpera, koja je zasnovana na projektu „Baš Čelik"
// (github.com/ubavic/bas-celik, AGPL-3.0) — pa je i ovaj program pod istom licencom.
package main

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
	"strings"

	"github.com/ebfe/scard"
)

const port = "8765"

// Sajtovi kojima helper sme da odgovori. Produkcijski domen je UGRAĐEN — ne sme da zavisi
// od toga da li se neko setio da ga prosledi (ranije je baš to bio uzrok odbijanja 403).
var allowed = map[string]bool{
	"https://autoserviss23.rs":     true,
	"https://www.autoserviss23.rs": true,
	"http://localhost:5173":        true,
	"http://127.0.0.1:5173":        true,
	"http://localhost:3000":        true,
}

func main() {
	// Prvi argument dodaje još jedan dozvoljen sajt (za razvoj/druge domene).
	if len(os.Args) > 1 && strings.TrimSpace(os.Args[1]) != "" {
		allowed[strings.TrimSpace(os.Args[1])] = true
	}

	http.HandleFunc("/status", handler(statusJSON))
	http.HandleFunc("/read", handler(readVehicle))

	fmt.Println("  AUTO SERVIS S23 — čitač saobraćajne")
	fmt.Println("  ────────────────────────────────────────────")
	fmt.Println("  Čitač radi. Ostavite ovaj prozor otvoren dok radite.")
	fmt.Println("  Na sajtu: novo vozilo → „Učitaj saobraćajnu\".")
	fmt.Println()
	fmt.Println("  Ako ne radi, otvorite: http://127.0.0.1:" + port + "/status")
	fmt.Println()

	// Namerno samo loopback — nedostupno spolja.
	if err := http.ListenAndServe("127.0.0.1:"+port, nil); err != nil {
		fmt.Println("  GREŠKA: ne mogu da otvorim port " + port + " — je li već pokrenut drugi čitač?")
		fmt.Println("  ", err)
		fmt.Print("  Pritisnite Enter za izlaz...")
		fmt.Scanln()
	}
}

// handler dodaje CORS/PNA zaglavlja i pretvara rezultat u JSON.
func handler(job func() (any, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		ok := origin != "" && allowed[origin]
		if ok {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Set("Vary", "Origin")
			// Chrome poziv sa javnog sajta ka 127.0.0.1 = „Private Network Access";
			// bez ovog zaglavlja ga blokira pre nego što uopšte stigne do nas.
			w.Header().Set("Access-Control-Allow-Private-Network", "true")
		}
		if r.Method == http.MethodOptions {
			if ok {
				w.Header().Set("Access-Control-Allow-Methods", "GET, OPTIONS")
				w.Header().Set("Access-Control-Allow-Headers", "Content-Type")
				w.Header().Set("Access-Control-Max-Age", "600")
			}
			w.WriteHeader(http.StatusNoContent)
			return
		}
		if origin != "" && !ok {
			writeJSON(w, http.StatusForbidden, map[string]string{"error": "origin nije dozvoljen"})
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		res, err := job()
		if err != nil {
			writeJSON(w, http.StatusOK, map[string]string{"error": err.Error()})
			return
		}
		writeJSON(w, http.StatusOK, res)
	}
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.WriteHeader(code)
	// SetEscapeHTML(false) da srpska slova i „<>" ostanu čitljiva u JSON-u.
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

// ─────────────────────────── PC/SC: nalaženje čitača ───────────────────────────

// firstCardReader vraća naziv prvog čitača u kome IMA kartice (kao Java verzija).
func firstCardReader(ctx *scard.Context) (string, bool, error) {
	readers, err := ctx.ListReaders()
	if err != nil || len(readers) == 0 {
		return "", false, fmt.Errorf("Nema priključenog čitača.")
	}
	// Stanje svih čitača odjednom.
	states := make([]scard.ReaderState, len(readers))
	for i, r := range readers {
		states[i].Reader = r
		states[i].CurrentState = scard.StateUnaware
	}
	if err := ctx.GetStatusChange(states, 0); err == nil {
		for i := range states {
			if states[i].EventState&scard.StatePresent != 0 {
				return readers[i], true, nil
			}
		}
	}
	// Nijedan sa karticom — vrati prvi (da /status javi da čitač postoji, ali nema kartice).
	return readers[0], false, nil
}

func statusJSON() (any, error) {
	ctx, err := scard.EstablishContext()
	if err != nil {
		return nil, fmt.Errorf("Nema priključenog čitača.")
	}
	defer ctx.Release()
	reader, present, err := firstCardReader(ctx)
	if err != nil {
		return nil, err
	}
	return map[string]any{"reader": reader, "cardPresent": present}, nil
}

// ─────────────────────────── Čitanje kartice ───────────────────────────

func readVehicle() (any, error) {
	ctx, err := scard.EstablishContext()
	if err != nil {
		return nil, fmt.Errorf("Nema priključenog čitača.")
	}
	defer ctx.Release()

	reader, present, err := firstCardReader(ctx)
	if err != nil {
		return nil, err
	}
	if !present {
		return nil, fmt.Errorf("Nema kartice u čitaču.")
	}

	card, err := ctx.Connect(reader, scard.ShareShared, scard.ProtocolAny)
	if err != nil {
		// Najčešće: zvanična aplikacija drži karticu za sebe.
		return nil, fmt.Errorf("Kartici se ne može pristupiti — zatvorite zvaničnu aplikaciju za čitanje pa probajte ponovo.")
	}
	defer card.Disconnect(scard.LeaveCard)

	if err := initCard(card); err != nil {
		return nil, err
	}

	var all []node
	for _, name := range [][]byte{{0xD0, 0x01}, {0xD0, 0x11}, {0xD0, 0x21}, {0xD0, 0x31}} {
		data, err := readFile(card, name)
		if err != nil {
			return nil, err
		}
		all = append(all, parse(data)...)
	}

	owner := strings.TrimSpace(access(all, 0x71, 0xA1, 0xA2, 0x84) + " " + access(all, 0x71, 0xA1, 0xA2, 0x83))
	return map[string]any{
		"vin":          access(all, 0x71, 0x8A),
		"make":         access(all, 0x71, 0xA3, 0x87),
		"model":        access(all, 0x71, 0xA3, 0x89),
		"fuel":         access(all, 0x71, 0xA5, 0x92),
		"year":         access(all, 0x72, 0xC5),
		"plate":        access(all, 0x71, 0x81),
		"ownerName":    owner,
		"ownerAddress": access(all, 0x71, 0xA1, 0xA2, 0x85),
	}, nil
}

func transmit(card *scard.Card, apdu []byte) ([]byte, uint16, error) {
	rsp, err := card.Transmit(apdu)
	if err != nil {
		return nil, 0, err
	}
	if len(rsp) < 2 {
		return nil, 0, fmt.Errorf("kratak odgovor kartice")
	}
	sw := uint16(rsp[len(rsp)-2])<<8 | uint16(rsp[len(rsp)-1])
	return rsp[:len(rsp)-2], sw, nil
}

// initCard proba tri poznate AID sekvence (kao Java verzija); prva koja prođe otvara aplikaciju.
func initCard(card *scard.Card) error {
	seqs := [][3][]byte{
		{
			{0xA0, 0x00, 0x00, 0x01, 0x51, 0x00, 0x00},
			{0xA0, 0x00, 0x00, 0x00, 0x77, 0x01, 0x08, 0x00, 0x07, 0x00, 0x00, 0xFE, 0x00, 0x00, 0x01, 0x00},
			{0xA0, 0x00, 0x00, 0x00, 0x77, 0x01, 0x08, 0x00, 0x07, 0x00, 0x00, 0xFE, 0x00, 0x00, 0xAD, 0xF2},
		},
		{
			{0xA0, 0x00, 0x00, 0x00, 0x03, 0x00, 0x00, 0x00},
			{0xF3, 0x81, 0x00, 0x00, 0x02, 0x53, 0x45, 0x52, 0x56, 0x4C, 0x04, 0x02, 0x01},
			{0xA0, 0x00, 0x00, 0x00, 0x77, 0x01, 0x08, 0x00, 0x07, 0x00, 0x00, 0xFE, 0x00, 0x00, 0xAD, 0xF2},
		},
		{
			{0xA0, 0x00, 0x00, 0x00, 0x18, 0x43, 0x4D, 0x00},
			{0xA0, 0x00, 0x00, 0x00, 0x18, 0x34, 0x14, 0x01, 0x00, 0x65, 0x56, 0x4C, 0x2D, 0x30, 0x30, 0x31},
			{0xA0, 0x00, 0x00, 0x00, 0x18, 0x65, 0x56, 0x4C, 0x2D, 0x30, 0x30, 0x31},
		},
	}
	for _, s := range seqs {
		_, sw, err := transmit(card, selectAPDU(0x04, 0x00, s[0]))
		if err != nil || sw != 0x9000 {
			continue
		}
		_, _, _ = transmit(card, selectAPDU(0x04, 0x00, s[1]))
		_, _, _ = transmit(card, selectAPDU(0x04, 0x0C, s[2]))
		return nil
	}
	return fmt.Errorf("Kartica ne reaguje (nije saobraćajna?).")
}

func selectAPDU(p1, p2 byte, data []byte) []byte {
	apdu := []byte{0x00, 0xA4, p1, p2, byte(len(data))}
	return append(apdu, data...)
}

func readBinary(card *scard.Card, off, length int) ([]byte, error) {
	if length > 0xFF {
		length = 0xFF
	}
	data, _, err := transmit(card, []byte{0x00, 0xB0, byte(off >> 8), byte(off & 0xFF), byte(length)})
	return data, err
}

func readFile(card *scard.Card, name []byte) ([]byte, error) {
	_, sw, err := transmit(card, selectAPDU(0x02, 0x04, name))
	if err != nil || sw != 0x9000 {
		return nil, fmt.Errorf("select file")
	}
	h, err := readBinary(card, 0, 0x20)
	if err != nil || len(h) < 2 {
		return nil, fmt.Errorf("čitanje zaglavlja")
	}
	off := int(h[1]) + 2
	tag := parseTag(h, off)
	ln := parseLen(h, off+tag.size)
	length := ln.value + tag.size + ln.size
	var out []byte
	for length > 0 {
		chunk := length
		if chunk > 0x64 {
			chunk = 0x64
		}
		d, err := readBinary(card, off, chunk)
		if err != nil || len(d) == 0 {
			break
		}
		out = append(out, d...)
		off += len(d)
		length -= len(d)
	}
	return out, nil
}

// ─────────────────────────── BER-TLV (kao Java verzija) ───────────────────────────

type node struct {
	tag         int
	constructed bool
	value       []byte
	children    []node
}

type tagInfo struct {
	tag, size int
	primitive bool
}
type lenInfo struct{ value, size int }

func parseTag(d []byte, p int) tagInfo {
	b0 := int(d[p])
	prim := b0&0x20 == 0
	if b0&0x1F != 0x1F {
		return tagInfo{b0, 1, prim}
	}
	b1 := int(d[p+1])
	if b1&0x80 == 0 {
		return tagInfo{(b0 << 8) | b1, 2, prim}
	}
	b2 := int(d[p+2])
	return tagInfo{(b0 << 16) | (b1 << 8) | b2, 3, prim}
}

func parseLen(d []byte, p int) lenInfo {
	f := int(d[p])
	switch {
	case f < 0x80:
		return lenInfo{f, 1}
	case f == 0x81:
		return lenInfo{int(d[p+1]), 2}
	case f == 0x82:
		return lenInfo{(int(d[p+1]) << 8) | int(d[p+2]), 3}
	case f == 0x83:
		return lenInfo{(int(d[p+1]) << 16) | (int(d[p+2]) << 8) | int(d[p+3]), 4}
	}
	return lenInfo{0, 1}
}

func parse(d []byte) []node {
	var out []node
	p := 0
	for p < len(d) {
		if d[p] == 0x00 || d[p] == 0xFF {
			p++
			continue
		}
		t := parseTag(d, p)
		p += t.size
		if p >= len(d) {
			break
		}
		l := parseLen(d, p)
		p += l.size
		length := l.value
		if p+length > len(d) {
			length = len(d) - p
		}
		val := d[p : p+length]
		p += length
		n := node{tag: t.tag, constructed: !t.primitive, value: val}
		if n.constructed {
			n.children = parse(val)
		}
		out = append(out, n)
	}
	return out
}

// merge spaja čvorove sa istim tagom (konstruisani spajaju decu) — kao Java verzija.
func merge(nodes []node) map[int]node {
	m := map[int]node{}
	order := []int{}
	for _, n := range nodes {
		if e, ok := m[n.tag]; !ok {
			c := node{tag: n.tag, constructed: n.constructed, value: n.value}
			c.children = append(c.children, n.children...)
			m[n.tag] = c
			order = append(order, n.tag)
		} else if e.constructed && n.constructed {
			e.children = append(e.children, n.children...)
			m[n.tag] = e
		}
	}
	_ = order
	return m
}

func access(nodes []node, path ...int) string {
	m := merge(nodes)
	n, ok := m[path[0]]
	if !ok {
		return ""
	}
	if len(path) == 1 {
		if n.constructed {
			return ""
		}
		return strings.TrimSpace(string(n.value))
	}
	return access(n.children, path[1:]...)
}
