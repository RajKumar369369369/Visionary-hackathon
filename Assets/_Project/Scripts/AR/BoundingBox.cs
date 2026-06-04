using System.Collections.Generic;
using UnityEngine;

namespace FitCheck.AR
{
    [RequireComponent(typeof(BoxCollider))]
    [RequireComponent(typeof(Rigidbody))]
    public class BoundingBox : MonoBehaviour
    {
        [Header("Material Settings")]
        [Tooltip("Material when placement is clear and fits the space.")]
        public Material validMaterial;
        
        [Tooltip("Material when clipping into physical obstacles.")]
        public Material clippingMaterial;

        [Header("Clearance Check Settings")]
        [Tooltip("Layer mask for AR planes to measure clearance against.")]
        public LayerMask arPlaneLayer;
        
        [Tooltip("Maximum distance to look for surrounding walls/obstacles.")]
        public float maxClearanceCheckDistance = 3.0f;

        private Renderer _renderer;
        private BoxCollider _boxCollider;
        private ItemData _currentItemData;
        private List<Collider> _overlappingColliders = new List<Collider>();
        private bool _isClipping = false;

        // Visual Dimension Line Sub-components
        private struct DimensionLine
        {
            public Vector3 Direction;
            public LineRenderer Line;
            public TextMesh TextObj;
            public string Label;
        }
        private List<DimensionLine> _dimensionLines = new List<DimensionLine>();

        private void Awake()
        {
            _renderer = GetComponent<Renderer>();
            _boxCollider = GetComponent<BoxCollider>();
            
            // Set up physics components for collision detection
            _boxCollider.isTrigger = true;
            
            Rigidbody rb = GetComponent<Rigidbody>();
            rb.isKinematic = true;
            rb.useGravity = false;
        }

        /// <summary>
        /// Initializes the bounding box scale and settings based on ItemData.
        /// </summary>
        public void Initialize(ItemData data)
        {
            _currentItemData = data;
            
            // Assuming pivot of the prefab is at the bottom-center
            // Set scale 1:1 in meters
            transform.localScale = Vector3.one; // Reset scale to prevent multiplication stacking
            
            // Adjust BoxCollider size to fit the visual mesh (1x1x1 cube)
            _boxCollider.size = Vector3.one;
            _boxCollider.center = new Vector3(0, 0.5f, 0); // Center is half the height up if pivot is bottom

            // Scale the parent container to match metric dimensions
            transform.localScale = data.Scale;

            // Clear previous states
            _overlappingColliders.Clear();
            UpdateVisualState();

            // Set up dimension lines
            CreateDimensionLines();
        }

        private void OnDestroy()
        {
            // Clean up dynamically created line/text objects
            foreach (var dl in _dimensionLines)
            {
                if (dl.Line != null) Destroy(dl.Line.gameObject);
            }
        }

        private void Update()
        {
            if (_currentItemData == null) return;
            
            UpdateClearanceLines();
        }

        #region Collision & Material Management

        private void OnTriggerEnter(Collider other)
        {
            // Check if we hit an AR Plane or environment collider
            if (other.gameObject != this.gameObject && !_overlappingColliders.Contains(other))
            {
                _overlappingColliders.Add(other);
                UpdateVisualState();
            }
        }

        private void OnTriggerExit(Collider other)
        {
            if (_overlappingColliders.Contains(other))
            {
                _overlappingColliders.Remove(other);
                UpdateVisualState();
            }
        }

        private void UpdateVisualState()
        {
            _isClipping = _overlappingColliders.Count > 0;
            
            if (_renderer != null)
            {
                _renderer.material = _isClipping ? clippingMaterial : validMaterial;
            }
        }

        #endregion

        #region Clearance Dimension Lines (Option A+ Wow Factor)

        /// <summary>
        /// Programmatically creates line renderers and 3D text for 5 directions (Left, Right, Front, Back, Top)
        /// to show clearance distances to physical surfaces in real time.
        /// </summary>
        private void CreateDimensionLines()
        {
            // Clear existing lines if re-initializing
            foreach (var dl in _dimensionLines)
            {
                if (dl.Line != null) Destroy(dl.Line.gameObject);
            }
            _dimensionLines.Clear();

            // Define the 5 directions to raycast from the box faces
            var directions = new[]
            {
                new { dir = Vector3.right, label = "R" },
                new { dir = Vector3.left, label = "L" },
                new { dir = Vector3.forward, label = "F" },
                new { dir = Vector3.back, label = "B" },
                new { dir = Vector3.up, label = "Top" }
            };

            foreach (var item in directions)
            {
                // Create a sub-object for line and text
                GameObject lineObj = new GameObject($"Clearance_{item.label}");
                lineObj.transform.SetParent(this.transform, false);

                LineRenderer lr = lineObj.AddComponent<LineRenderer>();
                lr.positionCount = 2;
                lr.startWidth = 0.02f;
                lr.endWidth = 0.02f;
                lr.useWorldSpace = true;
                
                // Light gray dashed/dotted material setup (use Default-Line if nothing else is specified)
                lr.material = new Material(Shader.Find("Sprites/Default"));
                lr.startColor = Color.white;
                lr.endColor = Color.white;

                // Create text label
                GameObject textObj = new GameObject("Text");
                textObj.transform.SetParent(lineObj.transform, false);
                textObj.transform.localScale = Vector3.one * 0.1f; // Scaled down for world space

                TextMesh tm = textObj.AddComponent<TextMesh>();
                tm.fontSize = 24;
                tm.characterSize = 0.1f;
                tm.anchor = TextAnchor.MiddleCenter;
                tm.alignment = TextAlignment.Center;
                tm.color = Color.white;

                _dimensionLines.Add(new DimensionLine
                {
                    Direction = item.dir,
                    Line = lr,
                    TextObj = tm,
                    Label = item.label
                });
            }
        }

        private void UpdateClearanceLines()
        {
            // Since we scaled the Bounding Box container, we must calculate sizes carefully.
            float w = _currentItemData.width;
            float h = _currentItemData.height;
            float d = _currentItemData.depth;

            Vector3 pivot = transform.position;

            foreach (var dl in _dimensionLines)
            {
                // Determine ray origin based on pivot (bottom-center) and directions
                Vector3 origin = pivot;
                if (dl.Direction == Vector3.up)
                {
                    origin += transform.up * h;
                }
                else
                {
                    // For side faces, start raycast from center height of the box
                    origin += transform.up * (h / 2.0f);
                    
                    if (dl.Direction == Vector3.right) origin += transform.right * (w / 2.0f);
                    else if (dl.Direction == Vector3.left) origin -= transform.right * (w / 2.0f);
                    else if (dl.Direction == Vector3.forward) origin += transform.forward * (d / 2.0f);
                    else if (dl.Direction == Vector3.back) origin -= transform.forward * (d / 2.0f);
                }

                // Fire the ray in the world direction
                Vector3 worldDir = transform.TransformDirection(dl.Direction);
                Ray ray = new Ray(origin, worldDir);

                if (Physics.Raycast(ray, out RaycastHit hit, maxClearanceCheckDistance, arPlaneLayer))
                {
                    // Plane detected! Show line and distance
                    dl.Line.enabled = true;
                    dl.Line.SetPosition(0, origin);
                    dl.Line.SetPosition(1, hit.point);

                    // Adjust line color based on proximity
                    float distanceCm = hit.distance * 100.0f;
                    Color color = distanceCm < 15.0f ? Color.red : Color.cyan;
                    dl.Line.startColor = color;
                    dl.Line.endColor = color;

                    // Place text midpoint of the line, facing the camera/user
                    dl.TextObj.gameObject.SetActive(true);
                    dl.TextObj.transform.position = Vector3.Lerp(origin, hit.point, 0.5f) + Vector3.up * 0.05f;
                    dl.TextObj.text = $"{dl.Label}: {distanceCm:F0} cm";
                    dl.TextObj.color = color;
                    
                    // Force text to face user's camera
                    if (Camera.main != null)
                    {
                        dl.TextObj.transform.rotation = Quaternion.LookRotation(dl.TextObj.transform.position - Camera.main.transform.position);
                    }
                }
                else
                {
                    // No plane hit within check distance, hide the guide
                    dl.Line.enabled = false;
                    dl.TextObj.gameObject.SetActive(false);
                }
            }
        }

        #endregion
    }
}
