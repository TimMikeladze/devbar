import { describe, expect, test } from "bun:test";
import { redactReport } from "../src/output/redact";

describe("redactReport", () => {
	test("removes screenshots and what was typed into fields", () => {
		const out = redactReport(
			[
				"- **Screenshot:** ![element](data:image/png;base64,AAAA)",
				'<input type="password" value="hunter2" name="pw">',
				"  - `value`: hunter2",
			].join("\n"),
		);
		expect(out).not.toContain("hunter2");
		expect(out).not.toContain("base64");
		expect(out).toContain('name="pw"');
	});

	test("removes credentials, emails, card numbers and secret URL parameters", () => {
		const secrets = [
			"Authorization: Bearer abc.def",
			"ghp_abcdefghijklmnopqrstuvwxyz012345",
			"sk_live_abcdefghijklmnop",
			"eyJhbGciOi.eyJzdWIiOi.c2lnbmF0dXJl",
			"kim@acme.com",
			"4242 4242 4242 4242",
		];
		const out = redactReport(
			// A header's value runs to the end of its line, so each gets its own.
			`${secrets.join("\n")}\nhttps://app.example/reset?token=s3cret&tab=2`,
		);
		for (const secret of secrets) expect(out).not.toContain(secret);
		expect(out).not.toContain("s3cret");
		expect(out).toContain("tab=2");
	});

	test("leaves the rest of the report readable", () => {
		const report = [
			"# Bug report",
			"- **Element:** `button.save`",
			"- **Bounds:** 120×40 at (10, 20)",
			"order 1234567890123",
		].join("\n");
		expect(redactReport(report)).toBe(report);
	});
});
