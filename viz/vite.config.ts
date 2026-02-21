import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => {
	const isDesktopMode = mode === 'desktop';
	return {
		// Browser/hosted deploys are served under /viz/ on GitHub Pages.
		// Desktop Electron file:// loads must use relative asset URLs.
		base: isDesktopMode ? './' : '/viz/'
	};
});
