-- Podaci firme koji idu na ponudu/predračun/račun (spec §4.13).
--
-- Bez broja računa mušterija nema gde da uplati, pa račun nije upotrebljiv kao
-- pravi dokument. Matični broj ide uz PIB na pravnim dokumentima u Srbiji.
ALTER TABLE settings
  ADD COLUMN company_id   text,   -- matični broj
  ADD COLUMN bank_account text,   -- tekući račun (npr. 265-1110310008045-17)
  ADD COLUMN bank_name    text;   -- naziv banke
