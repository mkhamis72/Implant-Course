/** User-facing message for a failed patient insert/update. */
export function patientSaveError(error: { code?: string; message: string }, fileNo: string): string {
  if (error.code === '23505') {
    return fileNo
      ? `File number ${fileNo} is already used by another patient.`
      : 'The automatic file number was just taken by another patient. Click Save again.';
  }
  console.error('Patient save failed:', error.message);
  return 'The patient could not be saved. Please try again.';
}
