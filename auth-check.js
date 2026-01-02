// Authentication check for protected pages
// This script should be included at the top of TMR.html, NotesHQ.html, and Docs.html

(function() {
  // Check if user is authenticated or in guest mode
  const userId = localStorage.getItem('user_id');
  const guestMode = localStorage.getItem('guest_mode');

  if (!userId && !guestMode) {
    // Not logged in and not in guest mode - redirect to intro
    console.log('[Auth Check] User not authenticated, redirecting to intro.html');
    window.location.href = 'intro.html';
  }
})();
