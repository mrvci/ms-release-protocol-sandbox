using UnityEditor;
using UnityEngine;

/// <summary>
/// Minimal -executeMethod probe for the MSTECH-1570 license proof: if this runs,
/// the GameCI container booted Unity 6000.3.16f1 on a GitHub-hosted runner and a
/// license was acquired. Mirrors the invocation shape of
/// MarbleSort.Build.Editor.AddressablesDuplicateBundleCheck.RunForCI.
/// </summary>
public static class CIProbe
{
    public static void Run()
    {
        Debug.Log("[CIProbe] Unity is licensed and executing -executeMethod on this runner.");
        EditorApplication.Exit(0);
    }
}
