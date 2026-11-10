// An invented excavation in the style of a German-language recording database: units with their
// unit type (Schicht, Verfüllung …), phase, object and object group, and the stratigraphy as
// columns of the unit table ("liegt_über", "liegt_unter", "zeitgleich_mit", several units per
// cell), a phase table whose rows name the next phase, and finds. Consistent: younger phases lie
// above older ones. Used by run-matrix-check and the cross-check with the GraphExplorer and the
// OntoGraphNavigator.
import { addTables, emptyCatalog } from '../../src/lib/catalog'
import { readSource } from '../../src/sources/index'

const csv = (file, text) => readSource(file, new TextEncoder().encode(text)).tables[0]

// Semicolon-separated like a German Excel export; cells listing several units are quoted.
export const SE_CSV = `SE_Nr;Bezeichnung;Einheitstyp;Phase;Objekt;Objektgruppe;liegt_über;liegt_unter;zeitgleich_mit;Beschreibung
SE1;Humus;Schicht;P3;;;SE2;;;Oberboden, dunkelbraun
SE2;Planierung;Schicht;P3;;;"SE3; SE4";SE1;;Planierschicht mit Ziegelbruch
SE3;Grubenverfüllung;Verfüllung;P2;Grube 1;Gehöft A;SE5;SE2;;Lockere Verfüllung mit Holzkohle
SE4;Grube;Interface;P2;Grube 1;Gehöft A;SE6;SE2;;Rundliche Grube
SE5;Mauer;Mauer;P2;Mauer 1;Gehöft A;SE7;SE3;SE6;Bruchsteinmauer
SE6;Fundament;Mauer;P2;Mauer 1;Gehöft A;SE7;SE4;SE5;Fundament der Mauer
SE7;Brandschicht;Ablagerung;P1;;;SE8;"SE5; SE6";;Holzkohlereiche Schicht
SE8;Lehm;Schicht;P1;;;;SE7;;Anstehender Lehm
`

export const PHASEN_CSV = `Phase_ID;Bezeichnung;nächste_Phase
P1;Römisch;P2
P2;Spätantik;P3
P3;Neuzeit;
`

export const FUNDE_CSV = `Fund_Nr;SE_Nr;Material
F1;SE3;Keramik
F2;SE3;Bronze
F3;SE5;Keramik
F4;SE7;Eisen
F5;SE7;Keramik
F6;SE2;Glas
`

export const catalog = () => addTables(emptyCatalog(), [csv('SE.csv', SE_CSV), csv('Phasen.csv', PHASEN_CSV), csv('Funde.csv', FUNDE_CSV)])

/** The same with a phase table naming the phase *before* (the order turned round). */
export const catalogReversed = () => addTables(emptyCatalog(), [
  csv('SE.csv', SE_CSV),
  csv('Phasen.csv', 'Phase_ID;Bezeichnung;vorherige_Phase\nP1;Römisch;\nP2;Spätantik;P1\nP3;Neuzeit;P2\n'),
  csv('Funde.csv', FUNDE_CSV),
])
