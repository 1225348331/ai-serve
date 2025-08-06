export const getError = (err: any) => {
	return `${err instanceof Error ? err.message : String(err)}`;
};
