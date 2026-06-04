using System.Collections.Generic;
using UnityEngine;
using UnityEngine.XR.ARFoundation;
using UnityEngine.XR.ARSubsystems;

namespace FitCheck.AR
{
    [RequireComponent(typeof(ARPlaneManager))]
    public class ARPlaneController : MonoBehaviour
    {
        private ARPlaneManager _planeManager;
        private List<ARPlane> _detectedPlanes = new List<ARPlane>();

        private void Awake()
        {
            _planeManager = GetComponent<ARPlaneManager>();
        }

        private void OnEnable()
        {
            _planeManager.planesChanged += OnPlanesChanged;
        }

        private void OnDisable()
        {
            _planeManager.planesChanged -= OnPlanesChanged;
        }

        /// <summary>
        /// Triggered when planes are added, updated, or removed by AR Foundation.
        /// </summary>
        private void OnPlanesChanged(ARPlanesChangedEventArgs args)
        {
            foreach (var plane in args.added)
            {
                // We only care about horizontal planes (floor surfaces) for anchoring
                if (plane.alignment == PlaneAlignment.HorizontalUp || plane.alignment == PlaneAlignment.HorizontalDown)
                {
                    _detectedPlanes.Add(plane);
                }
            }

            foreach (var plane in args.removed)
            {
                _detectedPlanes.Remove(plane);
            }
        }

        /// <summary>
        /// Enable or disable plane detection scanning.
        /// </summary>
        public void SetDetectionEnabled(bool enable)
        {
            _planeManager.enabled = enable;
        }

        /// <summary>
        /// Toggles whether the detected planes are visible in the scene.
        /// Useful to clean up the screen once an item is spawned.
        /// </summary>
        public void SetPlanesVisible(bool visible)
        {
            foreach (var plane in _detectedPlanes)
            {
                if (plane != null)
                {
                    // Disable visual components on individual plane objects
                    var meshRenderer = plane.GetComponent<MeshRenderer>();
                    if (meshRenderer != null) meshRenderer.enabled = visible;

                    var lineRenderer = plane.GetComponent<LineRenderer>();
                    if (lineRenderer != null) lineRenderer.enabled = visible;
                    
                    // Optional: Disable collider if we don't want to raycast on it anymore,
                    // but keep it if we need clipping checks (depending on Option A setup)
                }
            }
        }

        /// <summary>
        /// Clear all tracked planes from memory (useful on reset).
        /// </summary>
        public void ClearPlanes()
        {
            foreach (var plane in _detectedPlanes)
            {
                if (plane != null)
                {
                    Destroy(plane.gameObject);
                }
            }
            _detectedPlanes.Clear();
        }
    }
}
