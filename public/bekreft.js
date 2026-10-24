const token = new URLSearchParams(location.search).get("t");
const knapp = document.getElementById("knapp");
const status = document.getElementById("status");
if (!token) {
  knapp.hidden = true;
  status.dataset.tilstand = "feil";
  status.textContent = "Lenken mangler et gyldig token. Ingenting er endret.";
} else {
  knapp.addEventListener("click", send);
}
async function send() {
  knapp.disabled = true;
  status.dataset.tilstand = "venter";
  status.textContent = "Lagrer …";
  try {
    const res = await fetch("https://zyyijlvmgoanjdzngmon.supabase.co/functions/v1/meld-pa", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Accept": "application/json" },
      body: JSON.stringify({ handling: "bekreft", token })
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data && data.ok === true) {
      status.dataset.tilstand = "ok";
      status.textContent = data.melding;
      knapp.hidden = true;
    } else {
      status.dataset.tilstand = "feil";
      status.textContent = (data && data.feil) || "Lagringen feilet. Ingenting er endret.";
      knapp.disabled = false;
    }
  } catch (e) {
    status.dataset.tilstand = "feil";
    status.textContent = "Fikk ikke kontakt. Ingenting er endret.";
    knapp.disabled = false;
  }
}
