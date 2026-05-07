(function() {
  const liveServerBase = window.location.origin === 'file:' || window.location.hostname === 'localhost'
    ? 'http://localhost:8090/fedl'
    : 'https://server.fedl.site/fedl';

  let configCache = null;

  async function fetchConfig() {
    if (configCache) return configCache;
    try {
      const res = await fetch(`${liveServerBase}/api/config`);
      if (!res.ok) throw new Error('Failed to fetch config');
      configCache = await res.json();
      return configCache;
    } catch (err) {
      console.error('[OAuth] Failed to fetch config:', err);
      return null;
    }
  }

  window.signinGoogle = async function() {
    const config = await fetchConfig();
    if (!config || !config.googleClientId) {
      alert('Google sign-in is not configured.');
      return;
    }
    const redirectUri = `${window.location.origin}/oauth-callback.html`;
    const url = `https://accounts.google.com/o/oauth2/v2/auth?client_id=${encodeURIComponent(config.googleClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=openid%20profile%20email&state=google`;
    window.location.href = url;
  };

  window.signinDiscord = async function() {
    const config = await fetchConfig();
    if (!config || !config.discordClientId) {
      alert('Discord sign-in is not configured.');
      return;
    }
    const redirectUri = `${window.location.origin}/oauth-callback.html`;
    const url = `https://discord.com/api/oauth2/authorize?client_id=${encodeURIComponent(config.discordClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&scope=identify%20email&state=discord`;
    window.location.href = url;
  };

  window.signinGitHub = async function() {
    const config = await fetchConfig();
    if (!config || !config.githubClientId) {
      alert('GitHub sign-in is not configured.');
      return;
    }
    const redirectUri = `${window.location.origin}/oauth-callback.html`;
    const url = `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(config.githubClientId)}&redirect_uri=${encodeURIComponent(redirectUri)}&scope=user%3Aemail&state=github`;
    window.location.href = url;
  };
})();
