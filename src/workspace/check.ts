import type { WorkspaceConfig } from "../config";
import { classifyPath } from "./classify";
import {
	featureFields,
	featureId,
	FEATURE_STATUSES,
	DEFAULT_PRODUCT_DIR,
	readMeta,
} from "./feature";

/**
 * `devbar product check`: the links in `product/` and `specs/` that point at
 * nothing. Selectors are not checked here, because only a live page can say
 * whether one still matches.
 */

export type ProductProblem = { path: string; level: "error" | "warning"; message: string };

export function checkProduct(
	files: { path: string; content: string }[],
	config: WorkspaceConfig = {},
): ProductProblem[] {
	const dir = config.product === false ? undefined : (config.product ?? DEFAULT_PRODUCT_DIR);
	const paths = new Set(files.map((f) => f.path));
	const ids = new Set(
		dir
			? files
					.filter((f) => classifyPath(f.path, config)?.kind === "feature")
					.map((f) => featureId(f.path, dir))
			: [],
	);
	const problems: ProductProblem[] = [];
	for (const file of files) {
		const kind = classifyPath(file.path, config)?.kind;
		if (kind !== "feature" && kind !== "knowledge" && kind !== "spec") continue;
		const { meta, error } = readMeta(file.content);
		if (error) {
			problems.push({
				path: file.path,
				level: "error",
				message: `invalid frontmatter: ${error}`,
			});
			continue;
		}
		const fields = featureFields(meta);
		if (kind === "spec" && fields.feature && !ids.has(fields.feature)) {
			problems.push({
				path: file.path,
				level: "error",
				message: `feature: ${fields.feature} does not exist`,
			});
		}
		if (kind !== "feature") continue;
		for (const link of fields.knowledge ?? []) {
			if (!paths.has(link)) {
				problems.push({
					path: file.path,
					level: "error",
					message: `knowledge: ${link} does not exist`,
				});
			}
		}
		for (const page of fields.pages ?? []) {
			if (!page.startsWith("/")) {
				problems.push({
					path: file.path,
					level: "warning",
					message: `pages: ${page} does not start with /`,
				});
			}
		}
		const status = meta.status;
		if (typeof status === "string" && !FEATURE_STATUSES.includes(status)) {
			problems.push({
				path: file.path,
				level: "warning",
				message: `status: ${status} is not one of ${FEATURE_STATUSES.join(", ")}`,
			});
		}
	}
	return problems;
}
