import { queryKeys } from "@management-os/api-client";
import type { ActionItemStatus } from "@management-os/domain";
import { emptyStateCopy } from "@management-os/ui-core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/components/action-button";
import { Card } from "@/components/card";
import { MessageCard } from "@/components/message-card";
import { Screen } from "@/components/screen";
import { api, apiConfigured } from "@/lib/api";
import { useAppTheme } from "@/theme";

export default function ActionsScreen() {
  const theme = useAppTheme();
  const queryClient = useQueryClient();
  const actions = useQuery({
    queryKey: queryKeys.actions.all,
    queryFn: api.getActions,
    enabled: apiConfigured,
  });
  const update = useMutation({
    mutationFn: ({ id, status }: { id: string; status: ActionItemStatus }) =>
      api.updateActionStatus(id, status),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.actions.all }),
  });

  return (
    <Screen
      eyebrow="Command queue"
      title="Actions"
      refreshing={actions.isFetching}
      onRefresh={apiConfigured ? () => void actions.refetch() : undefined}
    >
      {!apiConfigured ? (
        <MessageCard
          title="Actions API pending"
          body="The shared client is ready for GET /api/v1/actions and status updates."
        />
      ) : actions.data?.length ? (
        actions.data.map((action) => (
          <Card key={action.id} style={styles.card}>
            <View style={styles.meta}>
              <Text style={[styles.status, { color: theme.colors.accent }]}>
                {action.status.toUpperCase()}
              </Text>
              {action.dueAt ? (
                <Text style={{ color: theme.colors.textMuted }}>
                  {new Date(action.dueAt).toLocaleDateString()}
                </Text>
              ) : null}
            </View>
            <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
              {action.title}
            </Text>
            {action.detail ? (
              <Text
                style={[styles.detail, { color: theme.colors.textSecondary }]}
              >
                {action.detail}
              </Text>
            ) : null}
            <View style={styles.buttons}>
              <ActionButton
                label="Approve"
                variant="primary"
                onPress={() =>
                  update.mutate({ id: action.id, status: "approved" })
                }
              />
              <ActionButton
                label="Defer"
                onPress={() =>
                  update.mutate({ id: action.id, status: "deferred" })
                }
              />
              <ActionButton
                label="Dismiss"
                variant="danger"
                onPress={() =>
                  update.mutate({ id: action.id, status: "dismissed" })
                }
              />
            </View>
          </Card>
        ))
      ) : (
        <MessageCard
          title={actions.isError ? "Actions unavailable" : "No open actions"}
          body={
            actions.error instanceof Error
              ? actions.error.message
              : emptyStateCopy.actions
          }
        />
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  meta: { flexDirection: "row", justifyContent: "space-between" },
  status: { fontSize: 10, fontWeight: "700", letterSpacing: 1 },
  title: { fontSize: 17, fontWeight: "600", lineHeight: 23 },
  detail: { fontSize: 14, lineHeight: 21 },
  buttons: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
});
