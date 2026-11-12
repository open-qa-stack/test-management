function Get-Policy { param($Id) }
class PolicyClient { [string] Fetch([string]$id) { return $id } }
