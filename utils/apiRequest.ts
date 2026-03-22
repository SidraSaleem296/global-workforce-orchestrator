export const readJsonBody = async <T>(request: Request): Promise<T> => {
  try {
    return await request.json() as T;
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
};

export const requireString = (value: unknown, fieldName: string): string => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${fieldName} is required.`);
  }

  return value.trim();
};
