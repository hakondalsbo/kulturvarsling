const VERSJON = "nyhetsbrev-2026-10";
const skjema = document.getElementById("skjema");
const status = document.getElementById("status");
const knapp = document.getElementById("send");
skjema.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const samtykke = document.getElementById("samtykke");
  if (!samtykke.checked) {
    status.dataset.tilstand = "feil";
    status.textContent = "Du må krysse av for samtykke.";
    return;
  }
  knapp.disabled = true;
  status.dataset.tilstand = "venter";
  status.textContent = "Sender …";
  try {
    const res = await fetch("https://zyyijlvmgoanjdzngmon.supabase.co/functions/v1/meld-pa", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({
        fornavn: document.getElementById("fornavn").value,
        etternavn: document.getElementById("etternavn").value,
        epost: document.getElementById("epost").value,
        samtykke: true,
        samtykke_tekst_versjon: VERSJON,
        kv_hp_felt: document.getElementById("kv_hp_felt").value
      })
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok === true) {
      skjema.hidden = true;
      status.dataset.tilstand = "ok";
      status.textContent = data.melding || "Sjekk e-posten din og bekreft påmeldingen.";
    } else {
      status.dataset.tilstand = "feil";
      status.textContent = (data && data.feil) || "Påmeldingen ble ikke registrert. Prøv igjen.";
      knapp.disabled = false;
    }
  } catch (e) {
    status.dataset.tilstand = "feil";
    status.textContent = "Fikk ikke kontakt. Påmeldingen ble ikke registrert.";
    knapp.disabled = false;
  }
});
