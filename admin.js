// Admin page initializer for the separate admin panel.
(function(){
  if (document.body.dataset.page !== 'admelist') {
    document.body.dataset.page = 'admelist';
  }

  window.addEventListener('DOMContentLoaded', function(){
    const loginScreen = document.getElementById('admin-login-screen');
    const shell = document.getElementById('admin-shell-content');
    if (loginScreen && shell) {
      // Admin page assets are ready.
    }
  });
})();
