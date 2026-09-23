import { useLayoutEffect, useState, type RefObject } from "react";

export interface ContainerSize {
  width: number | null;
  height: number | null;
}

/**
 * Taille observée d'un conteneur, avec un anti-rebond : évite de relancer un
 * traitement coûteux (ex. reconstruire une simulation d3) à chaque frame
 * pendant un redimensionnement continu — seule la taille une fois stabilisée
 * déclenche une mise à jour.
 *
 * La mesure initiale se fait dans un effet de layout (avant peinture) plutôt
 * que dans l'initialisateur de useState : lire `ref.current` au rendu
 * donnerait la valeur du rendu précédent, pas celle du DOM tout juste monté.
 */
export function useContainerSize<T extends HTMLElement>(
  ref: RefObject<T | null>,
  debounceMs = 150
): ContainerSize {
  const [size, setSize] = useState<ContainerSize>({ width: null, height: null });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const measure = () => {
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (width && height) setSize({ width, height });
    };

    measure(); // taille initiale : pas besoin d'attendre l'anti-rebond

    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(measure, debounceMs);
    });
    ro.observe(el);

    return () => {
      if (timer) clearTimeout(timer);
      ro.disconnect();
    };
  }, [ref, debounceMs]);

  return size;
}
