export function byScore(items) {
	return [...items].sort((left, right) => right.score - left.score);
}
