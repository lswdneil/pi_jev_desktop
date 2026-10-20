export function sumRange(n) {
	let total = 0;
	for (let value = 1; value <= n; value++) total += value;
	return total;
}
