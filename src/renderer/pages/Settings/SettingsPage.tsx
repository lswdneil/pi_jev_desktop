// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The settings screen: the harness's manifest, rendered.
 *
 * There is no hand-written form here and no list of known settings. A feature the kernel adds shows up because it is
 * in the manifest; an option whose kind this build has never seen shows up as a read-only row instead of vanishing.
 * A change is written by the main process (which validates it against the same manifest) and takes effect when the
 * agent restarts, so the screen says so rather than pretending otherwise.
 */

import { useCallback, useEffect, useState } from "react";
import type { ConsentState, ModelChoice, MuApi } from "../../../shared/api.ts";
import { localized, MANIFEST_LANGUAGES, applyChange, type SettingsSnapshot } from "../../../shared/settings.ts";
import { fill } from "../../../shared/presentation.ts";
import type { UpdateCheckResult, UpdateInstallOutcome } from "../../../shared/update.ts";
import { OptionControl } from "../../lib/manifest-renderer.tsx";

export function SettingsPage({
	api,
	language,
	setLanguage,
	text,
}: {
	readonly api: MuApi;
	readonly language: string;
	readonly setLanguage: (language: string) => void;
	readonly text: (key: string) => string;
}): React.JSX.Element {
	const [snapshot, setSnapshot] = useState<SettingsSnapshot | undefined>(undefined);
	const [consent, setConsent] = useState<ConsentState | undefined>(undefined);
	const [models, setModels] = useState<readonly ModelChoice[]>([]);
	const [currentModel, setCurrentModel] = useState("");
	const [modelBusy, setModelBusy] = useState(false);
	const [error, setError] = useState<string>("");
	const [saving, setSaving] = useState(false);
	const [saved, setSaved] = useState("");

	const load = useCallback(async () => {
		try {
			setSnapshot(await api.settings.snapshot());
			setConsent(await api.consent.status());
		} catch (failure) {
			setError(failure instanceof Error ? failure.message : String(failure));
		}
		void api.harness
			.models()
			.then(setModels)
			.catch(() => setModels([]));
		void api.harness
			.snapshot()
			.then((value) => {
				if (value.model !== undefined) setCurrentModel(value.model);
			})
			.catch(() => {});
	}, [api]);

	useEffect(() => {
		void load();
	}, [load]);

	const change = useCallback(
		async (featureName: string, optionKey: string, value: unknown) => {
			if (snapshot === undefined) return;
			const previous = snapshot;
			setSaving(true);
			setSaved("");
			setError("");
			// Show the value at once: a checkbox that waits for a round trip feels broken. The main process applies the
			// same rule again before writing, and this is what it would look like if it refused.
			try {
				setSnapshot({ ...previous, document: applyChange(previous.document, previous.manifest, { feature: featureName, option: optionKey, value }) });
			} catch (failure) {
				setError(failure instanceof Error ? failure.message : String(failure));
				setSaving(false);
				return;
			}
			try {
				const next = await api.settings.write({ feature: featureName, option: optionKey, value });
				setSnapshot(next);
				setSaved(text("settings.restart"));
			} catch (failure) {
				setSnapshot(previous);
				setError(failure instanceof Error ? failure.message : String(failure));
			} finally {
				setSaving(false);
			}
		},
		[api, snapshot, text],
	);

	const chooseModel = useCallback(
		async (value: string) => {
			const [provider, ...rest] = value.split("/");
			const modelId = rest.join("/");
			if (provider === undefined || modelId === "") return;
			setModelBusy(true);
			setError("");
			try {
				await api.harness.setModel(provider, modelId);
				setCurrentModel(value);
				setSaved(text("settings.modelApplied"));
			} catch (failure) {
				setError(failure instanceof Error ? failure.message : String(failure));
			} finally {
				setModelBusy(false);
			}
		},
		[api, text],
	);

	if (error !== "") {
		return (
			<section className="panel" data-testid="settings-error">
				<h2>{text("settings.failed")}</h2>
				<p className="line-error">{error}</p>
			</section>
		);
	}
	if (snapshot === undefined) return <p className="muted">{text("settings.saving")}</p>;

	const { manifest, document, path, problems } = snapshot;

	return (
		<div className="settings" data-testid="settings">
			<header className="panel">
				<h2>{text("settings.title")}</h2>
				<p className="muted">{text("settings.intro")}</p>
				<p className="muted">
					{text("settings.file")}: <code>{path}</code>
				</p>
				<p className="row">
					<label htmlFor="settings-language">{text("settings.language")}</label>
					<select
						id="settings-language"
						value={language}
						onChange={(event) => setLanguage(event.target.value)}
						data-testid="settings-language"
					>
						{MANIFEST_LANGUAGES.map((code) => (
							<option key={code} value={code}>
								{code}
							</option>
						))}
					</select>
					<span className="grow" />
					{saved === "" ? null : (
						<span className="chip chip-running" data-testid="settings-saved">
							{saved}
						</span>
					)}
				</p>
				{problems.length === 0 ? null : (
					<div className="line-error" data-testid="settings-problems">
						<p>{text("settings.problems")}</p>
						<ul>
							{problems.map((problem) => (
								<li key={problem}>{problem}</li>
							))}
						</ul>
					</div>
				)}
			</header>

			<section className="panel" data-testid="settings-consent">
				<h2>{text("consent.title")}</h2>
				<p className="muted">{text("consent.body")}</p>
				{consent === undefined ? null : (
					<p data-testid="consent-state">
						{consent.granted ? text("consent.granted") : text("consent.declined")}
						{consent.fromEnvironment ? ` — ${text("consent.fromEnvironment")}` : ""}
					</p>
				)}
				<p className="row">
					<button
						type="button"
						data-testid="consent-grant"
						disabled={consent?.granted === true}
						onClick={() => {
							void api.consent
								.grant()
								.then(setConsent)
								.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
						}}
					>
						{text("consent.grant")}
					</button>
					<button
						type="button"
						data-testid="consent-revoke"
						disabled={consent?.granted !== true}
						onClick={() => {
							void api.consent
								.revoke()
								.then(setConsent)
								.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)));
						}}
					>
						{text("consent.decline")}
					</button>
				</p>
			</section>

			<section className="panel" data-testid="settings-features">
				<h2>{text("settings.features")}</h2>
				{manifest.features.length === 0 ? <p className="muted">{text("settings.empty")}</p> : null}
				{manifest.features.map((feature) => (
					<details key={feature.name} className="feature" data-feature={feature.name} open={feature.options.length <= 3}>
						<summary>
							<strong>{localized(feature.title, language, `feature.${feature.name}.title`)}</strong>
							{feature.summary === undefined ? null : (
								<span className="muted"> — {localized(feature.summary, language, `feature.${feature.name}.summary`)}</span>
							)}
						</summary>
						{feature.options.map((option) => (
							<OptionControl
								key={`${feature.name}.${option.key}`}
								feature={feature}
								option={option}
								document={document}
								language={language}
								saving={saving}
								onChange={(value) => {
									void change(feature.name, option.key, value);
								}}
							/>
						))}
					</details>
				))}
			</section>

			<section className="panel" data-testid="settings-decisions">
				<h2>{text("settings.decisions")}</h2>
				<ul className="decisions">
					{manifest.decisions.map((decision) => (
						<li key={decision.id} data-decision={decision.id}>
							<strong>{localized(decision.title, language, `decision.${decision.id}.title`)}</strong>
							<span className="muted"> — {localized(decision.summary, language, `decision.${decision.id}.summary`)}</span>
						</li>
					))}
				</ul>
			</section>

			{models.length === 0 ? null : (
				<section className="panel" data-testid="settings-models">
					<h2>{text("firstRun.model")}</h2>
					<label className="settings-model">
						<span className="muted">{text("settings.model")}</span>
						<select
							value={currentModel}
							onChange={(event) => void chooseModel(event.target.value)}
							disabled={modelBusy}
							data-testid="settings-model-picker"
						>
							{models.map((model) => {
								const value = `${model.provider}/${model.id}`;
								return (
									<option key={value} value={value}>
										{value}
									</option>
								);
							})}
						</select>
					</label>
				</section>
			)}

			<UpdateSection api={api} text={text} />
		</div>
	);
}

/** The update check: on demand, and it says what it found — including why it will not install it. */
function UpdateSection({ api, text }: { readonly api: MuApi; readonly text: (key: string) => string }): React.JSX.Element {
	const [status, setStatus] = useState<UpdateCheckResult | undefined>(undefined);
	const [install, setInstall] = useState<UpdateInstallOutcome | undefined>(undefined);
	const [busy, setBusy] = useState(false);

	const check = (): void => {
		setBusy(true);
		setInstall(undefined);
		void api.update
			.check()
			.then(setStatus)
			.catch((failure: unknown) =>
				setStatus({
					status: { state: "refused", reason: failure instanceof Error ? failure.message : String(failure) },
					feedUrl: "",
					canInstall: false,
				}),
			)
			.finally(() => setBusy(false));
	};

	const runInstall = (): void => {
		setBusy(true);
		void api.update
			.install()
			.then(setInstall)
			.catch((failure: unknown) =>
				setInstall({ state: "refused", reason: failure instanceof Error ? failure.message : String(failure) }),
			)
			.finally(() => setBusy(false));
	};

	const line = ((): string => {
		if (busy) return text("update.checking");
		if (status === undefined) return "";
		const value = status.status;
		if (value.state === "up-to-date") return fill(text("update.upToDate"), { version: value.current });
		if (value.state === "available") return fill(text("update.available"), { version: value.version, current: value.current });
		return fill(text("update.refused"), { reason: value.reason });
	})();

	return (
		<section className="panel" data-testid="update">
			<h2>{text("update.title")}</h2>
			<p className="row">
				<button type="button" data-testid="update-check" disabled={busy} onClick={check}>
					{text("update.check")}
				</button>
				{line === "" ? null : (
					<span className="muted" data-testid="update-status">
						{line}
					</span>
				)}
			</p>
			{status?.status.state === "available" ? (
				<p className="row">
					<button type="button" data-testid="update-install" disabled={busy} onClick={runInstall}>
						{text("update.install")}
					</button>
					{install === undefined ? null : (
						<span className="muted" data-testid="update-install-outcome">
							{install.state === "installed"
								? fill(text("update.installing"), { file: install.file })
								: fill(text("update.refused"), { reason: install.reason })}
						</span>
					)}
				</p>
			) : null}
			{status?.status.state === "available" && !status.canInstall ? (
				<p className="muted" data-testid="update-not-installed">
					{text("update.notInstalled")}
				</p>
			) : null}
			{status === undefined ? null : (
				<p className="muted">
					<code>{status.feedUrl}</code>
				</p>
			)}
		</section>
	);
}
