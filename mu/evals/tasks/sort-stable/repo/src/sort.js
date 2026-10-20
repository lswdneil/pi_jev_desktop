export function byScore(items) {
	return [...items].sort((left, right) => (left.score < right.score ? 1 : -1));
}
