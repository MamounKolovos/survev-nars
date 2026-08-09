export type Result<a, e> =
    | { readonly kind: "Ok"; readonly value: a }
    | { readonly kind: "Error"; readonly error: e };

export function Ok<a>(value: a): Result<a, never> {
    return { kind: "Ok", value };
}

export function Error<e>(error: e): Result<never, e> {
    return { kind: "Error", error };
}

export function isOk<a, e>(
    result: Result<a, e>,
): result is { readonly kind: "Ok"; readonly value: a } {
    return result.kind == "Ok";
}

export function isError<a, e>(
    result: Result<a, e>,
): result is { readonly kind: "Error"; readonly error: e } {
    return result.kind == "Error";
}
