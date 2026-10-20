// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * The first run: language, consent, model, done.
 *
 * Every step is skippable on purpose. Declining consent is a normal answer — local judges keep working and the keyless
 * remote judge is simply not used — and having no model or no key must still leave a usable app, because the cost of a
 * wizard that blocks is higher than the cost of a screen that says what to do next. Nothing here writes a file
 * directly: consent goes through the harness's own command, and the model goes through the running session.
 */

import { useEffect, useState } from "react";
import type { ModelChoice, SpecApi } from "../../../shared/api.ts";
import { MANIFEST_LANGUAGES } from "../../../shared/settings.ts";
import { shellText } from "../../lib/i18n.ts";

type Step = "language" | "consent" | "model";

export function FirstRunPage({
	api,
	language,
	setLanguage,
	text,
	onDone,
}: {
	readonly api: SpecApi;
	readonly language: string;
	readonly setLanguage: (language: string) => void;
	readonly text: (key: string) => string;
	readonly onDone: () => void;
}): React.JSX.Element {
	const [step, setStep] = useState<Step>("language");
	const [models, setModels] = useState<readonly ModelChoice[]>([]);
	const [chosen, setChosen] = useState<string>("");
	const [error, setError] = useState<string>("");
	const [busy, setBusy] = useState(false);

	// The wizard opens before the agent is up, so the model list is asked for until the harness answers: a first-run
	// screen that gives up on the first refused request would show "no models" to someone who has plenty.
	useEffect(() => {
		if (step !== "model") return;
		let alive = true;
		const load = async (): Promise<void> => {
			for (let attempt = 0; attempt < 40; attempt++) {
				if (!alive) return;
				try {
					const loaded = await api.harness.models();
					if (!alive) return;
					setModels(loaded);
					const first = loaded[0];
					if (first !== undefined) setChosen(`${first.provider}/${first.id}`);
					return;
				} catch {
					await new Promise((done) => setTimeout(done, 250));
				}
			}
		};
		void load();
		return () => {
			alive = false;
		};
	}, [api, step]);

	const grant = (accept: boolean): void => {
		setBusy(true);
		setError("");
		const action = accept ? api.consent.grant() : Promise.resolve(undefined);
		void action
			.catch((failure: unknown) => {
				// A failed grant is reported and the step still moves on: the app stays usable either way.
				setError(failure instanceof Error ? failure.message : String(failure));
			})
			.finally(() => {
				setBusy(false);
				setStep("model");
			});
	};

	const finish = (): void => {
		const [provider, ...rest] = chosen.split("/");
		const id = rest.join("/");
		if (provider === undefined || id === "") {
			onDone();
			return;
		}
		setBusy(true);
		void api.harness
			.setModel(provider, id)
			.then(onDone)
			.catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
			.finally(() => setBusy(false));
	};

	return (
		<main className="screen" data-testid="first-run" data-step={step}>
			<h1>{text("firstRun.title")}</h1>
			{error === "" ? null : (
				<p className="line-error" data-testid="first-run-error">
					{error}
				</p>
			)}

			{step === "language" ? (
				<section>
					<h2>{text("firstRun.language")}</h2>
					<div className="languages">
						{MANIFEST_LANGUAGES.map((code) => (
							<button
								key={code}
								type="button"
								className={code === language ? "active" : ""}
								data-language={code}
								onClick={() => setLanguage(code)}
							>
								{shellText(code, "nav.settings")} · {code}
							</button>
						))}
					</div>
				</section>
			) : null}

			{step === "consent" ? (
				<section data-testid="first-run-consent">
					<h2>{text("consent.title")}</h2>
					<p className="muted">{text("consent.body")}</p>
					<p className="row">
						<button type="button" data-testid="first-run-grant" disabled={busy} onClick={() => grant(true)}>
							{text("consent.grant")}
						</button>
						<button type="button" data-testid="first-run-decline" disabled={busy} onClick={() => grant(false)}>
							{text("consent.decline")}
						</button>
					</p>
				</section>
			) : null}

			{step === "model" ? (
				<section data-testid="first-run-model">
					<h2>{text("firstRun.model")}</h2>
					{models.length === 0 ? (
						<p className="muted" data-testid="first-run-no-models">
							{text("firstRun.noModels")}
						</p>
					) : (
						<ul className="models">
							{models.map((model) => {
								const value = `${model.provider}/${model.id}`;
								return (
									<li key={value}>
										<label>
											<input
												type="radio"
												name="model"
												value={value}
												checked={chosen === value}
												onChange={() => setChosen(value)}
											/>{" "}
											{value}
										</label>
									</li>
								);
							})}
						</ul>
					)}
					<p className="muted" data-testid="first-run-key-hint">
						{text("firstRun.keyHint")}
					</p>
					<p className="row">
						<button type="button" data-testid="first-run-finish" disabled={busy} onClick={finish}>
							{text("firstRun.finish")}
						</button>
					</p>
				</section>
			) : null}

			<p className="row">
				{step === "language" ? (
					<button type="button" data-testid="first-run-next" onClick={() => setStep("consent")}>
						{text("firstRun.next")}
					</button>
				) : null}
				{step === "model" ? (
					<button type="button" data-testid="first-run-back" onClick={() => setStep("consent")}>
						{text("firstRun.back")}
					</button>
				) : null}
			</p>
		</main>
	);
}
