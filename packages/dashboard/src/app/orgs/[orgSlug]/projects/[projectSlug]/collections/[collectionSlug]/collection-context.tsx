"use client";

import { createContext, useContext } from "react";

interface CollectionContextValue {
  selectedSlug: string | null;
  selectSource: (slug: string) => void;
  createSource: () => void;
}

const CollectionContext = createContext<CollectionContextValue>({
  selectedSlug: null,
  selectSource: () => {},
  createSource: () => {},
});

export const CollectionProvider = CollectionContext.Provider;

export function useCollectionContext() {
  return useContext(CollectionContext);
}
