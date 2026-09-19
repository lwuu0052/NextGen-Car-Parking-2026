const form = document.getElementById("createAccountForm");
const message = document.getElementById("createAccountMessage");

form.addEventListener("submit", function (event) {
  event.preventDefault();
  message.style.color = "#087a55";
  message.textContent = "Account form works. Connect it to the backend later.";
});
