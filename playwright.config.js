import { defineConfig, devices } from "@playwright/test";

// The page is static: any file server works. Both colour schemes run, since
// the palette is redefined for dark mode and contrast is checked in each.
export default defineConfig({
	testDir: "tests/e2e",
	forbidOnly: !!process.env.CI,
	reporter: process.env.CI ? "github" : "list",
	use: { baseURL: "http://127.0.0.1:4173/" },
	webServer: {
		command: "python3 -m http.server 4173 --bind 127.0.0.1",
		url: "http://127.0.0.1:4173/",
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
	],
});
