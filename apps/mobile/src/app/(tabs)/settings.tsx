import { useQuery } from "@tanstack/react-query";
import { Alert, StyleSheet, Text, View } from "react-native";

import { ActionButton } from "@/components/action-button";
import { Card } from "@/components/card";
import { Screen } from "@/components/screen";
import { useSession } from "@/auth/session-provider";
import { appConfig } from "@/lib/api";
import {
  getNotificationPermissionStatus,
  requestNotificationPermission,
} from "@/services/notifications";
import { useAppTheme } from "@/theme";

export default function SettingsScreen() {
  const theme = useAppTheme();
  const { session, logout } = useSession();
  const notificationPermission = useQuery({
    queryKey: ["notification-permission"],
    queryFn: getNotificationPermissionStatus,
  });

  async function enableNotifications() {
    const granted = await requestNotificationPermission();
    await notificationPermission.refetch();
    Alert.alert(
      granted ? "Notifications allowed" : "Notifications not enabled",
      granted
        ? "Device token registration will be added with the identity-provider flow."
        : "You can change this later in system settings.",
    );
  }

  return (
    <Screen eyebrow="Companion app" title="Settings">
      <Card style={styles.card}>
        <Text style={[styles.label, { color: theme.colors.textMuted }]}>
          SESSION
        </Text>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
          {session
            ? "Signed-in session available"
            : "Authentication not connected"}
        </Text>
        <Text style={[styles.body, { color: theme.colors.textSecondary }]}>
          The boundary supports secure tokens, refresh, and tenant selection.
          Login remains a TODO until the web identity provider flow is chosen.
        </Text>
        {session ? (
          <ActionButton
            label="Clear mobile session"
            variant="danger"
            onPress={() => void logout()}
          />
        ) : null}
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.label, { color: theme.colors.textMuted }]}>
          NOTIFICATIONS
        </Text>
        <Text style={[styles.title, { color: theme.colors.textPrimary }]}>
          {notificationPermission.data?.granted
            ? "Device permission enabled"
            : "Briefing reminders are off"}
        </Text>
        <Text style={[styles.body, { color: theme.colors.textSecondary }]}>
          Push token registration and server delivery are intentionally not
          implemented in this scaffold.
        </Text>
        <ActionButton
          label="Request permission"
          icon="notifications-outline"
          disabled={!appConfig.featureFlags.pushNotifications}
          onPress={() => void enableNotifications()}
        />
      </Card>

      <Card style={styles.card}>
        <Text style={[styles.label, { color: theme.colors.textMuted }]}>
          ENVIRONMENT
        </Text>
        <View style={styles.row}>
          <Text style={[styles.body, { color: theme.colors.textSecondary }]}>
            Platform
          </Text>
          <Text style={[styles.value, { color: theme.colors.textPrimary }]}>
            {appConfig.platform}
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.body, { color: theme.colors.textSecondary }]}>
            API
          </Text>
          <Text
            numberOfLines={1}
            style={[styles.value, { color: theme.colors.textPrimary }]}
          >
            {appConfig.apiBaseUrl || "not configured"}
          </Text>
        </View>
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  label: { fontSize: 10, fontWeight: "700", letterSpacing: 1.1 },
  title: { fontSize: 16, fontWeight: "600" },
  body: { fontSize: 14, lineHeight: 21 },
  row: {
    flexDirection: "row",
    gap: 16,
    justifyContent: "space-between",
  },
  value: { flex: 1, fontSize: 13, fontWeight: "500", textAlign: "right" },
});
