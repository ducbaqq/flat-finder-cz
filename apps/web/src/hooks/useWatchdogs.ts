"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { WatchdogsResponse, CreateWatchdogRequest } from "@flat-finder/types";
import { apiGet, apiPost, apiPatch, apiDelete } from "@/lib/api-client";
import { useState, useCallback } from "react";

export function useWatchdogs() {
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const query = useQuery<WatchdogsResponse>({
    queryKey: ["watchdogs", email],
    queryFn: () => apiGet<WatchdogsResponse>("/watchdogs", { email }),
    enabled: !!email && email.includes("@"),
  });

  const createMutation = useMutation({
    mutationFn: (data: CreateWatchdogRequest) =>
      apiPost<unknown>("/watchdogs", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchdogs", email] });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (id: number) => apiPatch<unknown>(`/watchdogs/${id}/toggle`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchdogs", email] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiDelete(`/watchdogs/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["watchdogs", email] });
    },
  });

  const setWatchdogEmail = useCallback(
    (e: string) => {
      setEmail(e);
    },
    []
  );

  const watchdogs = query.data?.watchdogs ?? [];
  const activeCount = watchdogs.filter((w) => w.active).length;

  return {
    email,
    setWatchdogEmail,
    watchdogs,
    activeCount,
    isLoading: query.isLoading,
    createWatchdog: createMutation.mutateAsync,
    isCreating: createMutation.isPending,
    toggleWatchdog: toggleMutation.mutateAsync,
    deleteWatchdog: deleteMutation.mutateAsync,
    refetch: query.refetch,
  };
}
