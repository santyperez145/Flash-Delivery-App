import type { GeoPoint } from "../types";

export type AccountRunAction = (action: () => Promise<unknown>, success: string) => void;

export type AccountAddressHandler = (address: string, point: GeoPoint | null) => void;
