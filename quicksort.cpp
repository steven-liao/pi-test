#include <iostream>
#include <vector>
#include <utility>
#include <stack>

// Partition: pick pivot, arrange elements, return pivot index
template <typename T>
int partition(std::vector<T>& arr, int low, int high) {
    T pivot = arr[high];  // choose last element as pivot
    int i = low - 1;      // index of smaller element

    for (int j = low; j < high; ++j) {
        if (arr[j] <= pivot) {
            ++i;
            std::swap(arr[i], arr[j]);
        }
    }
    std::swap(arr[i + 1], arr[high]);
    return i + 1;
}

// ── Recursive version ──────────────────────────
template <typename T>
void quickSortRecursive(std::vector<T>& arr, int low, int high) {
    if (low < high) {
        int pi = partition(arr, low, high);
        quickSortRecursive(arr, low, pi - 1);
        quickSortRecursive(arr, pi + 1, high);
    }
}

// ── Non-recursive (iterative) version ───────────
// Uses an explicit stack to avoid recursion depth issues.
// On average O(n log n), worst-case O(n) stack space.
template <typename T>
void quickSortIterative(std::vector<T>& arr, int low, int high) {
    std::stack<std::pair<int, int>> stk;
    stk.push({low, high});

    while (!stk.empty()) {
        auto [l, r] = stk.top();
        stk.pop();

        if (l < r) {
            int pi = partition(arr, l, r);

            // Push larger sub-array first to keep stack depth O(log n)
            int leftLen  = pi - 1 - l + 1;
            int rightLen = r - (pi + 1) + 1;

            if (leftLen > rightLen) {
                stk.push({l, pi - 1});
                stk.push({pi + 1, r});
            } else {
                stk.push({pi + 1, r});
                stk.push({l, pi - 1});
            }
        }
    }
}

// ── Unified wrappers ────────────────────────────
template <typename T>
void quickSort(std::vector<T>& arr, bool recursive = true) {
    if (arr.empty()) return;
    int n = static_cast<int>(arr.size()) - 1;
    if (recursive)
        quickSortRecursive(arr, 0, n);
    else
        quickSortIterative(arr, 0, n);
}

int main() {
    std::vector<int> arr = {10, 7, 8, 9, 1, 5};
    std::cout << "Original: ";
    for (int v : arr) std::cout << v << " ";
    std::cout << "\n";

    quickSort(arr, true);   // recursive

    std::cout << "Sorted (recursive):   ";
    for (int v : arr) std::cout << v << " ";
    std::cout << "\n";

    // Test iterative version on a reversed copy
    std::vector<int> arr2 = {10, 7, 8, 9, 1, 5};
    // also test with a larger array
    std::vector<int> arr3 = {3, 6, 2, 9, 1, 7, 8, 4, 5, 0};

    quickSort(arr2, false);  // iterative
    quickSort(arr3, false);  // iterative

    std::cout << "Sorted (iterative):   ";
    for (int v : arr2) std::cout << v << " ";
    std::cout << "\n";

    std::cout << "Sorted (iterative v2): ";
    for (int v : arr3) std::cout << v << " ";
    std::cout << "\n";
    return 0;
}
