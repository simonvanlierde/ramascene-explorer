import { defineConfig, devices } from "@playwright/test";

// The tests run against the built site, served by vite preview (which also
// serves the synthetic fixtures the build leaves out). The page has one light
// palette; the dark project checks that a dark-preferring browser still gets it
// with full contrast. Firefox, desktop Safari and iPhone run on Playwright's
// Firefox and WebKit builds, so the page is checked in all three engines.
export default defineConfig({
	testDir: "tests/e2e",
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? "github" : "list",
	use: { baseURL: "http://127.0.0.1:4180/" },
	webServer: {
		// CI builds in its own step, so a build error shows as that step failing
		command: process.env.CI ? "pnpm preview" : "pnpm build && pnpm preview",
		url: "http://127.0.0.1:4180/",
		reuseExistingServer: !process.env.CI,
	},
	projects: [
		{
			name: "light",
			use: { ...devices["Desktop Chrome"], colorScheme: "light" },
		},
		{
			name: "dark",
			use: { ...devices["Desktop Chrome"], colorScheme: "dark" },
		},
		{ name: "phone", use: { ...devices["Pixel 7"] } },
		{ name: "firefox", use: { ...devices["Desktop Firefox"] } },
		{ name: "safari", use: { ...devices["Desktop Safari"] } },
		{ name: "iphone", use: { ...devices["iPhone 13"] } },
	],
});
