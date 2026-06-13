import { AudioModule } from "expo-audio";

export async function requestVoiceCapturePermission(): Promise<boolean> {
  const result = await AudioModule.requestRecordingPermissionsAsync();
  return result.granted;
}
