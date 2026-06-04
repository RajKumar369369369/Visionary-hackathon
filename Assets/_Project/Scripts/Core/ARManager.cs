using System.Collections.Generic;
using UnityEngine;
using UnityEngine.EventSystems;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace FitCheck.Core
{
    [RequireComponent(typeof(ARRaycastManager))]
    public class ARManager : MonoBehaviour
    {
        [Header("References")]
        [Tooltip("The custom ARPlaneController script on the Session Origin / XR Origin.")]
        public AR.ARPlaneController planeController;

        [Tooltip("The 1:1 scale Bounding Box prefab to instantiate.")]
        public GameObject boundingBoxPrefab;

        [Header("Product Library")]
        [Tooltip("Hardcoded library of item dimensions (TV, Sofa, Fridge).")]
        public List<ItemData> itemLibrary = new List<ItemData>();

        private ARRaycastManager _raycastManager;
        private AR.BoundingBox _spawnedBox;
        private ItemData _selectedItemData;
        private static List<ARRaycastHit> s_Hits = new List<ARRaycastHit>();

        private void Awake()
        {
            _raycastManager = GetComponent<ARRaycastManager>();
        }

        private void Start()
        {
            // Auto-select the first item by default if available
            if (itemLibrary.Count > 0)
            {
                SelectItem(0);
            }
        }

        private void Update()
        {
            // Check for user input (mouse click for editor testing, touch for mobile device)
            #if UNITY_EDITOR
            if (Input.GetMouseButtonDown(0))
            {
                HandleInput(Input.mousePosition);
            }
            #else
            if (Input.touchCount > 0)
            {
                Touch touch = Input.GetTouch(0);
                if (touch.phase == TouchPhase.Began)
                {
                    HandleInput(touch.position);
                }
            }
            #endif
        }

        /// <summary>
        /// Selects an item from the library and updates the bounding box if already spawned.
        /// </summary>
        /// <param name="index">Index in the item library.</param>
        public void SelectItem(int index)
        {
            if (index < 0 || index >= itemLibrary.Count)
            {
                Debug.LogWarning("Selected index is out of bounds of the item library.");
                return;
            }

            _selectedItemData = itemLibrary[index];
            Debug.Log($"Selected item: {_selectedItemData.itemName} ({_selectedItemData.GetDimensionsStringMetric()})");

            // If the bounding box is already spawned, update its scale and data immediately!
            if (_spawnedBox != null)
            {
                _spawnedBox.Initialize(_selectedItemData);
            }
        }

        /// <summary>
        /// Sets a custom bounding box with user-defined metric scale dimensions.
        /// </summary>
        public void SelectCustomItem(string name, float width, float height, float depth)
        {
            // Dynamically create a temporary ItemData ScriptableObject
            ItemData customData = ScriptableObject.CreateInstance<ItemData>();
            customData.itemName = string.IsNullOrEmpty(name) ? "Custom Box" : name;
            customData.width = Mathf.Max(0.05f, width); // Minimum scale clamp of 5cm
            customData.height = Mathf.Max(0.05f, height);
            customData.depth = Mathf.Max(0.05f, depth);
            customData.itemDescription = "Custom-sized bounding box based on manual inputs.";

            _selectedItemData = customData;
            Debug.Log($"Selected custom item: {customData.itemName} ({customData.GetDimensionsStringMetric()})");

            if (_spawnedBox != null)
            {
                _spawnedBox.Initialize(_selectedItemData);
            }
        }

        /// <summary>
        /// Process tap/click coordinates and attempt to place/move the bounding box.
        /// </summary>
        private void HandleInput(Vector2 screenPosition)
        {
            // Prevent placing objects if the user taps on UI elements
            if (EventSystem.current != null && EventSystem.current.IsPointerOverGameObject())
            {
                #if !UNITY_EDITOR
                // On mobile, check specific finger id
                if (Input.touchCount > 0 && EventSystem.current.IsPointerOverGameObject(Input.GetTouch(0).fingerId))
                {
                    return;
                }
                #else
                return;
                #endif
            }

            if (_selectedItemData == null)
            {
                Debug.LogWarning("No item selected. Cannot place bounding box.");
                return;
            }

            // Raycast logic
            #if UNITY_EDITOR
            // Editor simulation: Raycast against physics colliders (e.g. simulated planes in Editor)
            Ray ray = Camera.main.ScreenPointToRay(screenPosition);
            if (Physics.Raycast(ray, out RaycastHit hit))
            {
                PlaceBoundingBox(hit.point, hit.transform.rotation);
            }
            #else
            // Device deployment: Raycast against AR Foundation detected planes
            if (_raycastManager.Raycast(screenPosition, s_Hits, TrackableType.PlaneWithinPolygon))
            {
                // Align placement orientation with the plane surface normal
                Pose hitPose = s_Hits[0].pose;
                PlaceBoundingBox(hitPose.position, hitPose.rotation);
            }
            #endif
        }

        /// <summary>
        /// Spawns or repositions the bounding box at the selected floor location.
        /// </summary>
        private void PlaceBoundingBox(Vector3 position, Quaternion rotation)
        {
            if (_spawnedBox == null)
            {
                // Instantiate the prefab
                GameObject boxObj = Instantiate(boundingBoxPrefab, position, rotation);
                _spawnedBox = boxObj.GetComponent<AR.BoundingBox>();
                
                // If the prefab doesn't have the script, log warning and add it dynamically
                if (_spawnedBox == null)
                {
                    _spawnedBox = boxObj.AddComponent<AR.BoundingBox>();
                }

                // Hide plane visuals after placing to keep the AR view neat (can still detect)
                if (planeController != null)
                {
                    planeController.SetPlanesVisible(false);
                }
            }
            else
            {
                // Reposition existing box
                _spawnedBox.transform.position = position;
                // Maintain rotation matching the plane alignment
                _spawnedBox.transform.rotation = rotation;
            }

            // (Re)initialize the box to match selected dimensions
            _spawnedBox.Initialize(_selectedItemData);
        }

        /// <summary>
        /// Resets the session: removes bounding box and visualizes/resets detected planes.
        /// </summary>
        public void ResetSession()
        {
            if (_spawnedBox != null)
            {
                Destroy(_spawnedBox.gameObject);
                _spawnedBox = null;
            }

            if (planeController != null)
            {
                planeController.ClearPlanes();
                planeController.SetPlanesVisible(true);
                planeController.SetDetectionEnabled(true);
            }
        }
    }
}
