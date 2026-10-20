export function validateName(name) {
	if (name.length > 40) throw new Error("name is too long");
	return name;
}
