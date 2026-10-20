// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2025-2026 the mu authors

/**
 * A control for one manifest option.
 *
 * The manifest says what kind of value an option takes, so the screen does not: a `boolean` becomes a checkbox, a
 * `choice` a select with the manifest's own labels, a `number` a field bounded by the manifest's own min and max. The
 * default is never guessed here — `valueOf` returns the manifest's default when the document is silent, so there is no
 * second copy of a default in this file.
 */

import {
	describeValue,
	featureEnabled,
	localized,
	type ManifestFeature,
	type ManifestOption,
	type SettingsDocument,
	valueOf,
} from "../../shared/settings.ts";
import { shellText } from "../lib/i18n.ts";

export function OptionControl({
	feature,
	option,
	document,
	language,
	saving,
	onChange,
}: {
	readonly feature: ManifestFeature;
	readonly option: ManifestOption;
	readonly document: SettingsDocument;
	readonly language: string;
	readonly saving: boolean;
	readonly onChange: (value: unknown) => void;
}): React.JSX.Element {
	const value = valueOf(document, feature, option);
	const label = localized(option.label, language, `${feature.name}.${option.key}.label`);
	const help = option.help === undefined ? undefined : localized(option.help, language, `${feature.name}.${option.key}.help`);
	const disabled = saving || !featureEnabled(document, feature) || option.kind === "unsupported";
	const id = `option-${feature.name}-${option.key}`;

	return (
		<div className="option" data-option={`${feature.name}.${option.key}`}>
			<label className="option-label" htmlFor={id}>
				{label}
			</label>
			<div className="option-control">{control(option, value, disabled, id, language, onChange)}</div>
			{help === undefined ? null : <p className="option-help">{help}</p>}
			{option.kind === "unsupported" ? <p className="option-help">{shellText(language, "settings.readOnly")}</p> : null}
		</div>
	);
}

function control(
	option: ManifestOption,
	value: unknown,
	disabled: boolean,
	id: string,
	language: string,
	onChange: (value: unknown) => void,
): React.JSX.Element {
	switch (option.kind) {
		case "boolean":
			return (
				<input
					id={id}
					type="checkbox"
					checked={value === true}
					disabled={disabled}
					onChange={(event) => onChange(event.target.checked)}
				/>
			);
		case "number":
			return (
				<span className="number-row">
					<input
						id={id}
						type="number"
						value={typeof value === "number" ? value : 0}
						min={option.min}
						max={option.max}
						disabled={disabled}
						onChange={(event) => {
							const next = Number(event.target.value);
							if (Number.isFinite(next)) onChange(next);
						}}
					/>
					{option.unit === undefined ? null : (
						<span className="unit">{localized(option.unit, language, `${option.key}.unit`)}</span>
					)}
				</span>
			);
		case "text":
			return (
				<input
					id={id}
					type="text"
					value={typeof value === "string" ? value : ""}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
				/>
			);
		case "list":
			return (
				<textarea
					id={id}
					rows={3}
					value={Array.isArray(value) ? value.join("\n") : ""}
					disabled={disabled}
					onChange={(event) =>
						onChange(
							event.target.value
								.split("\n")
								.map((line) => line.trim())
								.filter((line) => line !== ""),
						)
					}
				/>
			);
		case "numbers":
			return (
				<textarea
					id={id}
					rows={2}
					value={Array.isArray(value) ? value.join(", ") : ""}
					disabled={disabled}
					onChange={(event) => {
						const numbers = event.target.value
							.split(/[\s,]+/)
							.filter((item) => item !== "")
							.map(Number)
							.filter((item) => Number.isFinite(item));
						onChange(numbers);
					}}
				/>
			);
		case "choice":
			return (
				<select
					id={id}
					value={typeof value === "string" ? value : option.default}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
				>
					{option.choices.map((choice) => (
						<option key={choice.value} value={choice.value}>
							{localized(choice.label, language, `${option.key}.${choice.value}`)}
						</option>
					))}
				</select>
			);
		case "unsupported":
			return <code id={id}>{describeValue(value)}</code>;
	}
}
