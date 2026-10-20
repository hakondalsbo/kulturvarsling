import { test } from "node:test";
import assert from "node:assert/strict";
import {
  erRegjeringsHoring,
  erSametingetHoring,
  parseRegjeringenHoringListe,
  parseRegjeringenHoringSide,
  prioriterStorting,
  regjeringenInnholdId,
  regjeringenSideUrl,
  skalOppdatereStortingFrist,
  stortingSakId,
  trekkHoringsfrist,
} from "./frister.ts";

const LISTE = `
<ul>
  <li class="listItem">
    <a href="/no/dokumenter/horing-noe/id3169144/">Tittel</a>
    <span class="event-details">Høringsfrist: 30.08.2026</span>
    <span class="event-details-open">Status: På høring</span>
  </li>
  <li class="listItem">
    <a href="/no/dokumenter/hoyring-noko/id3169000/">Nynorsk</a>
    <span class="event-details">Høyringsfrist: 1.12.2026</span>
  </li>
  <li class="listItem">
    <a href="/no/dokumenter/horing-uten-dato/id10/">Uten</a>
  </li>
</ul>`;

test("dokumentlisten gir innholds-id og bokmål/nynorsk-frist", () => {
  const ut = parseRegjeringenHoringListe(LISTE);
  assert.deepEqual(ut, [
    { innholdId: "3169144", frist: "2026-08-30" },
    { innholdId: "3169000", frist: "2026-12-01" },
    { innholdId: "10", frist: null },
  ]);
});

test("Sametinget-høring fanger «Høringsfristen er 23. november 2026»", () => {
  const html = `
    <h1>Høring: Behov for samiske tilbud, ordninger og tiltak i Sør-Norge valgkrets</h1>
    <p>Høringsfristen er 23. november 2026.</p>
    <p>Folkemøte i Stavanger 28. oktober skal ikke bli fristen.</p>`;
  assert.equal(trekkHoringsfrist(html), "2026-11-23");
  assert.equal(
    erSametingetHoring(
      "https://sametinget.no/aktuelt/horing-behov-for-samiske-tilbud-ordninger-og-tiltak-i-sor-norge-valgkrets.55024.aspx",
      "Høring: Behov for samiske tilbud",
    ),
    true,
  );
  assert.equal(
    erSametingetHoring(
      "https://sametinget.no/aktuelt/innvilgede-saker-12-10-26-18-10-26.55232.aspx",
      "Innvilgede saker 12.10.26-18.10.26",
    ),
    false,
  );
});

test("detaljsiden leser Høringsfrist fra horing-meta, også som entitet", () => {
  const html = `
    <div class="horing-meta content-row">
      <p><strong>Status:</strong> P&#xE5; h&#xF8;ring</p>
      <p><strong>H&#xF8;ringsfrist:</strong> 30.08.2026</p>
    </div>
    <p>Høringsfrist: 01.01.1999 i brødteksten skal ikke vinne</p>`;
  assert.equal(parseRegjeringenHoringSide(html), "2026-08-30");
  assert.equal(trekkHoringsfrist("ingen frist her"), null);
});

test("regjeringen-høring kjennes på instans eller sti, ikke på proposisjon", () => {
  const horing = "https://www.regjeringen.no/no/dokumenter/horing-nrk/id3157800/?utm_source=rss";
  assert.equal(regjeringenInnholdId(horing), "3157800");
  assert.equal(erRegjeringsHoring(horing, "Regjeringen – høring"), true);
  assert.equal(
    erRegjeringsHoring(
      "https://www.regjeringen.no/no/dokumenter/prop.-1-s-20262027/id3176084/",
      "Regjeringen – proposisjon",
    ),
    false,
  );
  assert.equal(
    regjeringenSideUrl(horing),
    "https://www.regjeringen.no/no/dokumenter/horing-nrk/id3157800/",
  );
});

test("stortingssak-id kommer fra p=, ikke fra ventede saker", () => {
  assert.equal(
    stortingSakId("https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/Sak/?p=200367"),
    "200367",
  );
  assert.equal(
    stortingSakId("https://www.stortinget.no/no/Saker-og-publikasjoner/Saker/ventede-saker/#sak-110"),
    null,
  );
});

test("gamle stortingsfrister hoppes over, manglende frist tas med først", () => {
  assert.equal(skalOppdatereStortingFrist(null, "2026-10-20"), true);
  assert.equal(skalOppdatereStortingFrist("2026-10-10", "2026-10-20"), true);
  assert.equal(skalOppdatereStortingFrist("2026-10-01", "2026-10-20"), false);
  const sortert = prioriterStorting([
    { id: "sen", frist: "2026-12-01" },
    { id: "tom", frist: null },
    { id: "nar", frist: "2026-10-21" },
  ]);
  assert.deepEqual(sortert.map((r) => r.id), ["tom", "nar", "sen"]);
});
