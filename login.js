const API_BASE = window.location.port === "5500"
  ? `${window.location.protocol}//${window.location.hostname}:3002`
  : "";

async function api(path, body) {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}

const form = document.getElementById("login-form");
const email = document.getElementById("email");
const password = document.getElementById("password");
const showPassword = document.getElementById("show-password");
const error = document.getElementById("error");

showPassword.addEventListener("change", () => {
  password.type = showPassword.checked ? "text" : "password";
});

form.addEventListener("submit", async e => {
  e.preventDefault();
  error.textContent = "";
  try {
    await api("/api/login", {
      email: email.value.trim(),
      password: password.value,
    });
    window.location.href = "./index.html";
  } catch (err) {
    error.textContent = err.message;
  }
});
