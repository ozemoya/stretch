
export type Coordinates = {
  lat: number;
  lon: number;
};

export const sampleStoreLocations: Record<
  string,
  Coordinates
> = {
  "market-a": {
    lat: 33.749,
    lon: -84.388,
  },
  "market-b": {
    lat: 33.783,
    lon: -84.383,
  },
  "market-c": {
    lat: 33.762,
    lon: -84.35,
  },
};

export const sampleStartingLocations: Record<
  string,
  Coordinates
> = {
  downtown: {
    lat: 33.749,
    lon: -84.388,
  },
  midtown: {
    lat: 33.783,
    lon: -84.383,
  },
  decatur: {
    lat: 33.7748,
    lon: -84.2963,
  },
};
