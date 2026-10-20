export function validateName(name) {
	if (typeof name !== "string" || name.trim() === "") throw new Error("name is required");
	if (name.length > 40) throw new Error("name is too long");
	return name;
}
