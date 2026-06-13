import {
  colors,
  radius,
  spacing,
  typography,
} from "@management-os/design-tokens";
import { useColorScheme } from "react-native";

export function useAppTheme() {
  const scheme = useColorScheme();
  return {
    dark: scheme === "dark",
    colors: scheme === "dark" ? colors.dark : colors.light,
    radius,
    spacing,
    typography,
  };
}

export type AppTheme = ReturnType<typeof useAppTheme>;
