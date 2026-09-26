"use client";

import { Devbar } from "devbar.sh";

import "devbar.sh/styles.css";

/** The toolbar, with the Workspace drawer pointed at this app's own route. */
export function DevToolbar() {
	return <Devbar workspace="/api/devbar" />;
}
