using UnityEngine;

namespace FitCheck.Core
{
    [CreateAssetMenu(fileName = "NewItemData", menuName = "FitCheck/Item Data", order = 1)]
    public class ItemData : ScriptableObject
    {
        [Header("Display Properties")]
        [Tooltip("The user-facing name of the retail item.")]
        public string itemName;
        
        [Tooltip("A short description of the item.")]
        [TextArea(2, 5)]
        public string itemDescription;

        [Header("Physical Dimensions (in Meters)")]
        [Tooltip("Width (left to right) of the item box in meters.")]
        public float width = 1.0f;
        
        [Tooltip("Height (bottom to top) of the item box in meters.")]
        public float height = 1.0f;
        
        [Tooltip("Depth (front to back) of the item box in meters.")]
        public float depth = 1.0f;

        /// <summary>
        /// Returns the dimensions as a Vector3 representing (Width, Height, Depth).
        /// </summary>
        public Vector3 Scale => new Vector3(width, height, depth);

        /// <summary>
        /// Helper to print size in inches if preferred by user.
        /// </summary>
        public string GetDimensionsStringImperial()
        {
            float wInches = width * 39.3701f;
            float hInches = height * 39.3701f;
            float dInches = depth * 39.3701f;
            return $"{wInches:F0}\" x {hInches:F0}\" x {dInches:F0}\"";
        }

        /// <summary>
        /// Helper to print size in meters/centimeters.
        /// </summary>
        public string GetDimensionsStringMetric()
        {
            return $"{width:F2}m x {height:F2}m x {depth:F2}m";
        }
    }
}
