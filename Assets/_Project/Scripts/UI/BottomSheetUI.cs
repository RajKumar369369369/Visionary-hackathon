using UnityEngine;
using UnityEngine.UI;

namespace FitCheck.UI
{
    public class BottomSheetUI : MonoBehaviour
    {
        [Header("References")]
        [Tooltip("Reference to the main ARManager in the scene.")]
        public Core.ARManager arManager;

        [Header("UI Text Outlets")]
        public Text itemNameText;
        public Text itemDimensionsText;
        public Text itemDescriptionText;

        [Header("Custom Dimension Input Fields")]
        public InputField customNameInput;
        public InputField customWidthInput;
        public InputField customHeightInput;
        public InputField customDepthInput;

        [Header("Animation Settings")]
        [Tooltip("The RectTransform of the sliding sheet panel.")]
        public RectTransform bottomSheetPanel;
        
        [Tooltip("Y-position when the sheet is collapsed.")]
        public float collapsedY = -250f;
        
        [Tooltip("Y-position when the sheet is fully open/expanded.")]
        public float expandedY = 50f;
        
        [Tooltip("Speed of the sliding transition.")]
        public float slideSpeed = 10f;

        private float _targetY;
        private bool _isExpanded = true;

        private void Start()
        {
            _targetY = expandedY;

            // Initialize UI text with the default item
            if (arManager != null && arManager.itemLibrary.Count > 0)
            {
                UpdateUI(arManager.itemLibrary[0]);
            }
        }

        private void Update()
        {
            // Smoothly slide the panel to the target position (Lerp for smooth transition)
            if (bottomSheetPanel != null)
            {
                Vector2 pos = bottomSheetPanel.anchoredPosition;
                pos.y = Mathf.Lerp(pos.y, _targetY, Time.deltaTime * slideSpeed);
                bottomSheetPanel.anchoredPosition = pos;
            }
        }

        /// <summary>
        /// Public callback for UI Buttons to select items.
        /// </summary>
        /// <param name="index">0 = TV, 1 = Sofa, 2 = Fridge</param>
        public void SelectItemButton(int index)
        {
            if (arManager == null) return;

            arManager.SelectItem(index);

            // Update bottom sheet texts
            if (index >= 0 && index < arManager.itemLibrary.Count)
            {
                UpdateUI(arManager.itemLibrary[index]);
            }
            
            // Expand sheet on item change
            ExpandSheet(true);
        }

        /// <summary>
        /// Toggles the bottom-sheet between expanded and collapsed states.
        /// </summary>
        public void ToggleSheet()
        {
            ExpandSheet(!_isExpanded);
        }

        public void ExpandSheet(bool expand)
        {
            _isExpanded = expand;
            _targetY = _isExpanded ? expandedY : collapsedY;
        }

        /// <summary>
        /// Reset the AR session from the UI button.
        /// </summary>
        public void ResetButton()
        {
            if (arManager != null)
            {
                arManager.ResetSession();
            }
        }

        private void UpdateUI(ItemData item)
        {
            if (item == null) return;

            if (itemNameText != null) 
                itemNameText.text = item.itemName;

            if (itemDimensionsText != null)
                itemDimensionsText.text = $"{item.GetDimensionsStringImperial()}  |  {item.GetDimensionsStringMetric()}";

            if (itemDescriptionText != null) 
                itemDescriptionText.text = item.itemDescription;
        }

        /// <summary>
        /// Reads custom inputs from UI input fields and tells ARManager to apply them.
        /// </summary>
        public void ApplyCustomDimensionsButton()
        {
            if (arManager == null) return;

            string name = (customNameInput != null && !string.IsNullOrEmpty(customNameInput.text)) 
                ? customNameInput.text 
                : "Custom Box";

            float w = ParseInputField(customWidthInput, 1.0f);
            float h = ParseInputField(customHeightInput, 1.0f);
            float d = ParseInputField(customDepthInput, 1.0f);

            arManager.SelectCustomItem(name, w, h, d);

            // Update UI Labels to show custom item dimensions
            if (itemNameText != null) itemNameText.text = name;
            if (itemDimensionsText != null)
            {
                float wInches = w * 39.3701f;
                float hInches = h * 39.3701f;
                float dInches = d * 39.3701f;
                itemDimensionsText.text = $"{wInches:F0}\"x{hInches:F0}\"x{dInches:F0}\" | {w:F2}m x {h:F2}m x {d:F2}m";
            }
            if (itemDescriptionText != null) itemDescriptionText.text = "Custom-dimensioned bounding box.";

            ExpandSheet(true);
        }

        private float ParseInputField(InputField field, float defaultValue)
        {
            if (field == null || string.IsNullOrEmpty(field.text)) return defaultValue;

            if (float.TryParse(field.text, out float value))
            {
                return value;
            }
            return defaultValue;
        }
    }
}
