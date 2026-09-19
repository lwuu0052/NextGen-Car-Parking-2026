const loginForm = document.getElementById("loginForm");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const togglePassword = document.getElementById("togglePassword");
const errorMessage = document.getElementById("errorMessage");

togglePassword.addEventListener("click", function () {
  passwordInput.type = passwordInput.type === "password" ? "text" : "password";
});

loginForm.addEventListener("submit", function (event) {
  event.preventDefault();

  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();

  if (username === "" || password === "") {
    errorMessage.textContent = "Please enter your username and password.";
    return;
  }

  errorMessage.textContent = "";

  // Connect the real backend login API here later.
  window.location.href = "dashboard.html";
});
