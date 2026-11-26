import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

import { API_BASE_URL } from "@/shared/config";

import { fetchNotifications, markAllNotificationsRead, markNotificationRead } from "../api/notification-api";
import { CloseCode, mergeIncoming, parseStreamMessage, reconnectDelay, streamUrl } from "./notification";

const VIDE = { items: [], unread: 0, next: null, loading: false, connected: false };

/**
 * Centre de notifications (sprint 13) : liste, compte des non lues, flux en
 * temps réel (WebSocket) avec reconnexion à délai croissant. À chaque
 * (re)connexion, la liste est relue : rien n'est perdu pendant une coupure.
 *
 * Fermeture 4401 (jeton expiré) : une requête ordinaire renouvelle le jeton,
 * puis on se reconnecte ; si la session est finie, la garde de session prend
 * le relais. Fermeture 4429 (trop d'onglets) : pas de reconnexion.
 */
export function useNotifications({ enabled, onArrive }) {
  const [state, setState] = useState(VIDE);
  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;

  const reload = useCallback(async () => {
    try {
      const page = await fetchNotifications();
      setState((s) => ({ ...s, ...page }));
      return true;
    } catch {
      return false;
    }
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof WebSocket === "undefined") {
      setState(VIDE);
      return undefined;
    }
    let ws;
    let timer;
    let tentative = 0;
    let arrete = false;

    const ouvrir = () => {
      ws = new WebSocket(streamUrl(API_BASE_URL, window.location));
      ws.onopen = () => {
        tentative = 0;
        setState((s) => ({ ...s, connected: true }));
        reload();
      };
      ws.onmessage = (event) => {
        const m = parseStreamMessage(event.data);
        if (!m) return;
        setState((s) => ({
          ...s,
          unread: m.unread,
          items: m.notification ? mergeIncoming(s.items, m.notification) : s.items,
        }));
        if (m.notification) onArriveRef.current?.(m.notification);
      };
      ws.onclose = async (event) => {
        setState((s) => ({ ...s, connected: false }));
        if (arrete || event.code === CloseCode.TOO_MANY_TABS) return;
        if (event.code === CloseCode.UNAUTHENTICATED && !(await reload())) return;
        if (!arrete) timer = setTimeout(ouvrir, reconnectDelay(tentative++));
      };
    };

    setState((s) => ({ ...s, loading: true }));
    reload().finally(() => setState((s) => ({ ...s, loading: false })));
    ouvrir();
    return () => {
      arrete = true;
      clearTimeout(timer);
      if (ws) {
        ws.onclose = null;
        ws.close();
      }
    };
  }, [enabled, reload]);

  const markRead = useCallback(async (id) => {
    let changed = false;
    setState((s) => {
      const items = s.items.map((n) => {
        if (n.id !== id || n.read) return n;
        changed = true;
        return { ...n, read: true };
      });
      return changed ? { ...s, items, unread: Math.max(0, s.unread - 1) } : s;
    });
    try {
      await markNotificationRead(id);
    } catch {
      reload();
    }
  }, [reload]);

  const markAllRead = useCallback(async () => {
    setState((s) => ({ ...s, unread: 0, items: s.items.map((n) => ({ ...n, read: true })) }));
    try {
      await markAllNotificationsRead();
    } catch {
      reload();
    }
  }, [reload]);

  const loadMore = useCallback(async () => {
    if (!state.next) return;
    try {
      const page = await fetchNotifications({ avant: state.next });
      setState((s) => ({ ...s, items: [...s.items, ...page.items.filter((n) => !s.items.some((m) => m.id === n.id))], next: page.next }));
    } catch {
      /* la liste actuelle reste affichée */
    }
  }, [state.next]);

  return { ...state, markRead, markAllRead, loadMore, reload };
}

/** Le centre, partagé par toute l'application (une seule connexion). */
export const NotificationsContext = createContext({ ...VIDE, enabled: false });

export function useNotificationCenter() {
  return useContext(NotificationsContext);
}
