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
import { Input } from "../ui/input.tsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select.tsx";
import { Switch } from "../ui/switch.tsx";
import { Textarea } from "../ui/textarea.tsx";

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
		<div className="option grid gap-2 border-b border-border/70 py-3 last:border-0" data-option={`${feature.name}.${option.key}`}>
			<div className="flex flex-wrap items-center justify-between gap-3">
				<label className="option-label text-[13px] font-medium" htmlFor={id}>
					{label}
				</label>
				<div className="option-control">{control(option, value, disabled, id, language, onChange)}</div>
			</div>
			{help === undefined ? null : <p className="option-help text-[11px] leading-5 text-muted-foreground">{help}</p>}
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
				<Switch
					id={id}
					checked={value === true}
					disabled={disabled}
					onCheckedChange={onChange}
				/>
			);
		case "number":
			return (
				<span className="flex items-center gap-2">
					<Input
						id={id}
						type="number"
						className="w-[9rem]"
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
						<span className="unit text-[11px] text-muted-foreground">{localized(option.unit, language, `${option.key}.unit`)}</span>
					)}
				</span>
			);
		case "text":
			return (
				<Input
					id={id}
					type="text"
					className="w-[min(24rem,100%)]"
					value={typeof value === "string" ? value : ""}
					disabled={disabled}
					onChange={(event) => onChange(event.target.value)}
				/>
			);
		case "list":
			return (
				<Textarea
					id={id}
					rows={3}
					className="min-h-[76px] w-[min(30rem,100%)]"
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
				<Textarea
					id={id}
					rows={2}
					className="min-h-[64px] w-[min(30rem,100%)]"
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
				<Select
					value={typeof value === "string" ? value : option.default}
					onValueChange={onChange}
					disabled={disabled}
				>
					<SelectTrigger id={id} className="w-[min(22rem,100%)]">
						<SelectValue />
					</SelectTrigger>
					<SelectContent>
						{option.choices.map((choice) => (
							<SelectItem key={choice.value} value={choice.value}>
								{localized(choice.label, language, `${option.key}.${choice.value}`)}
							</SelectItem>
						))}
					</SelectContent>
				</Select>
			);
		case "unsupported":
			return <code id={id}>{describeValue(value)}</code>;
	}
}
