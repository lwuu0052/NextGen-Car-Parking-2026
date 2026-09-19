const sidebar = document.getElementById('sidebar');
const mainArea = document.getElementById('mainArea');
const sidebarToggle = document.getElementById('sidebarToggle');

sidebarToggle.addEventListener('click', function () {
  sidebar.classList.toggle('collapsed');
  mainArea.classList.toggle('expanded');
});
