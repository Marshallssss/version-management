export function revisionLabel(revisionNo: number | null | undefined) {
  return revisionNo == null ? '补丁状态未确认' : revisionNo === 0 ? '原始版' : `修订 ${revisionNo}`
}
