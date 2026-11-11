#include <algorithm>
#include <cmath>
#include <iostream>
#include <limits>
#include <queue>
#include <stack>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

namespace {

constexpr double kTrafficFactor = 3.2;

struct Node {
  std::string id;
  double x;
  double y;
};

struct Edge {
  std::string to;
  double cost;
};

struct SearchResult {
  bool found = false;
  double total_cost = 0.0;
  std::vector<std::string> path;
  std::vector<std::string> visit_order;
  std::string message = "No route found";
};

double Heuristic(const Node& a, const Node& b) {
  const double dx = a.x - b.x;
  const double dy = a.y - b.y;
  return std::sqrt(dx * dx + dy * dy) / 110.0;
}

std::vector<std::string> ReconstructPath(
    const std::unordered_map<std::string, std::string>& previous,
    const std::string& start,
    const std::string& goal) {
  std::vector<std::string> path;
  if (start == goal) {
    return {start};
  }
  if (!previous.count(goal)) {
    return {};
  }

  std::string current = goal;
  while (true) {
    path.push_back(current);
    if (current == start) {
      break;
    }
    current = previous.at(current);
  }
  std::reverse(path.begin(), path.end());
  return path;
}

SearchResult RunDijkstra(
    const std::unordered_map<std::string, std::vector<Edge>>& graph,
    const std::string& start,
    const std::string& goal) {
  struct State {
    double cost;
    std::string id;
    bool operator>(const State& other) const { return cost > other.cost; }
  };

  std::priority_queue<State, std::vector<State>, std::greater<State>> pq;
  std::unordered_map<std::string, double> distance;
  std::unordered_map<std::string, std::string> previous;
  std::unordered_set<std::string> settled;
  SearchResult result;

  distance[start] = 0.0;
  pq.push({0.0, start});

  while (!pq.empty()) {
    const State current = pq.top();
    pq.pop();
    if (settled.count(current.id)) {
      continue;
    }
    settled.insert(current.id);
    result.visit_order.push_back(current.id);

    if (current.id == goal) {
      result.found = true;
      result.total_cost = current.cost;
      break;
    }

    const auto it = graph.find(current.id);
    if (it == graph.end()) {
      continue;
    }

    for (const Edge& edge : it->second) {
      const double next_cost = current.cost + edge.cost;
      if (!distance.count(edge.to) || next_cost < distance[edge.to]) {
        distance[edge.to] = next_cost;
        previous[edge.to] = current.id;
        pq.push({next_cost, edge.to});
      }
    }
  }

  result.path = ReconstructPath(previous, start, goal);
  if (result.path.empty() && start == goal) {
    result.found = true;
    result.path = {start};
  }
  if (result.found && result.path.empty()) {
    result.path = {start};
  }
  if (!result.found) {
    result.message = "No traffic-aware route found.";
  } else {
    result.message = "Traffic-aware shortest route found.";
  }
  return result;
}

SearchResult RunAStar(
    const std::unordered_map<std::string, std::vector<Edge>>& graph,
    const std::unordered_map<std::string, Node>& nodes,
    const std::string& start,
    const std::string& goal) {
  struct State {
    double score;
    double cost;
    std::string id;
    bool operator>(const State& other) const { return score > other.score; }
  };

  std::priority_queue<State, std::vector<State>, std::greater<State>> pq;
  std::unordered_map<std::string, double> g_score;
  std::unordered_map<std::string, std::string> previous;
  std::unordered_set<std::string> closed;
  SearchResult result;

  g_score[start] = 0.0;
  pq.push({Heuristic(nodes.at(start), nodes.at(goal)), 0.0, start});

  while (!pq.empty()) {
    const State current = pq.top();
    pq.pop();
    if (closed.count(current.id)) {
      continue;
    }
    closed.insert(current.id);
    result.visit_order.push_back(current.id);

    if (current.id == goal) {
      result.found = true;
      result.total_cost = current.cost;
      break;
    }

    const auto it = graph.find(current.id);
    if (it == graph.end()) {
      continue;
    }

    for (const Edge& edge : it->second) {
      const double tentative = g_score[current.id] + edge.cost;
      if (!g_score.count(edge.to) || tentative < g_score[edge.to]) {
        g_score[edge.to] = tentative;
        previous[edge.to] = current.id;
        const double f_score = tentative + Heuristic(nodes.at(edge.to), nodes.at(goal));
        pq.push({f_score, tentative, edge.to});
      }
    }
  }

  result.path = ReconstructPath(previous, start, goal);
  if (start == goal) {
    result.found = true;
    result.path = {start};
  }
  result.message = result.found ? "A* reached the goal using a traffic-aware heuristic."
                                : "A* could not reach the goal.";
  return result;
}

SearchResult RunBfs(
    const std::unordered_map<std::string, std::vector<Edge>>& graph,
    const std::string& start,
    const std::string& goal) {
  std::queue<std::string> queue;
  std::unordered_set<std::string> visited;
  std::unordered_map<std::string, std::string> previous;
  SearchResult result;

  queue.push(start);
  visited.insert(start);

  while (!queue.empty()) {
    const std::string current = queue.front();
    queue.pop();
    result.visit_order.push_back(current);

    if (current == goal) {
      result.found = true;
      break;
    }

    auto neighbors = graph.find(current);
    if (neighbors == graph.end()) {
      continue;
    }

    auto edges = neighbors->second;
    std::sort(edges.begin(), edges.end(), [](const Edge& a, const Edge& b) {
      return a.cost < b.cost;
    });

    for (const Edge& edge : edges) {
      if (visited.count(edge.to)) {
        continue;
      }
      visited.insert(edge.to);
      previous[edge.to] = current;
      queue.push(edge.to);
    }
  }

  result.path = ReconstructPath(previous, start, goal);
  if (start == goal) {
    result.found = true;
    result.path = {start};
  }
  if (result.found) {
    for (std::size_t i = 0; i + 1 < result.path.size(); ++i) {
      for (const Edge& edge : graph.at(result.path[i])) {
        if (edge.to == result.path[i + 1]) {
          result.total_cost += edge.cost;
          break;
        }
      }
    }
  }
  result.message = result.found ? "BFS found the fewest-hop style route."
                                : "BFS could not reach the goal.";
  return result;
}

SearchResult RunDfs(
    const std::unordered_map<std::string, std::vector<Edge>>& graph,
    const std::string& start,
    const std::string& goal) {
  struct StackItem {
    std::string id;
    std::string parent;
  };

  std::stack<StackItem> stack;
  std::unordered_set<std::string> visited;
  std::unordered_map<std::string, std::string> previous;
  SearchResult result;

  stack.push({start, ""});

  while (!stack.empty()) {
    const StackItem item = stack.top();
    stack.pop();
    const std::string current = item.id;
    if (visited.count(current)) {
      continue;
    }

    visited.insert(current);
    if (!item.parent.empty()) {
      previous[current] = item.parent;
    }
    result.visit_order.push_back(current);
    if (current == goal) {
      result.found = true;
      break;
    }

    auto neighbors = graph.find(current);
    if (neighbors == graph.end()) {
      continue;
    }

    auto edges = neighbors->second;
    std::sort(edges.begin(), edges.end(), [](const Edge& a, const Edge& b) {
      return a.cost > b.cost;
    });

    for (const Edge& edge : edges) {
      if (!visited.count(edge.to)) {
        stack.push({edge.to, current});
      }
    }
  }

  result.path = ReconstructPath(previous, start, goal);
  if (start == goal) {
    result.found = true;
    result.path = {start};
  }
  if (result.found) {
    for (std::size_t i = 0; i + 1 < result.path.size(); ++i) {
      for (const Edge& edge : graph.at(result.path[i])) {
        if (edge.to == result.path[i + 1]) {
          result.total_cost += edge.cost;
          break;
        }
      }
    }
  }
  result.message = result.found ? "DFS found a depth-first route."
                                : "DFS could not reach the goal.";
  return result;
}

}  // namespace

int main() {
  std::ios::sync_with_stdio(false);
  std::cin.tie(nullptr);

  std::string algorithm;
  std::string start;
  std::string goal;
  int node_count = 0;
  int edge_count = 0;

  if (!(std::cin >> algorithm >> start >> goal >> node_count >> edge_count)) {
    std::cout << "FOUND 0\n";
    std::cout << "ALGORITHM unknown\n";
    std::cout << "TOTAL_COST 0\n";
    std::cout << "VISITED_COUNT 0\n";
    std::cout << "MESSAGE Invalid input\n";
    std::cout << "PATH 0\n";
    std::cout << "VISIT_ORDER 0\n";
    return 0;
  }

  std::unordered_map<std::string, Node> nodes;
  nodes.reserve(static_cast<std::size_t>(node_count));
  for (int i = 0; i < node_count; ++i) {
    Node node;
    std::cin >> node.id >> node.x >> node.y;
    nodes[node.id] = node;
  }

  std::unordered_map<std::string, std::vector<Edge>> graph;
  for (int i = 0; i < edge_count; ++i) {
    std::string edge_id;
    std::string from;
    std::string to;
    double base_cost = 1.0;
    double traffic = 0.0;
    int blocked = 0;
    std::cin >> edge_id >> from >> to >> base_cost >> traffic >> blocked;
    if (blocked == 1) {
      continue;
    }

    const double weighted_cost = base_cost * (1.0 + traffic * kTrafficFactor);
    graph[from].push_back({to, weighted_cost});
    graph[to].push_back({from, weighted_cost});
  }

  SearchResult result;
  if (!nodes.count(start) || !nodes.count(goal)) {
    result.message = "Start or goal node does not exist.";
  } else if (algorithm == "dijkstra") {
    result = RunDijkstra(graph, start, goal);
  } else if (algorithm == "astar") {
    result = RunAStar(graph, nodes, start, goal);
  } else if (algorithm == "bfs") {
    result = RunBfs(graph, start, goal);
  } else if (algorithm == "dfs") {
    result = RunDfs(graph, start, goal);
  } else {
    result.message = "Unsupported algorithm.";
  }

  std::cout << "FOUND " << (result.found ? 1 : 0) << "\n";
  std::cout << "ALGORITHM " << algorithm << "\n";
  std::cout << "TOTAL_COST " << result.total_cost << "\n";
  std::cout << "VISITED_COUNT " << result.visit_order.size() << "\n";
  std::cout << "MESSAGE " << result.message << "\n";
  std::cout << "PATH " << result.path.size();
  for (const auto& id : result.path) {
    std::cout << " " << id;
  }
  std::cout << "\n";
  std::cout << "VISIT_ORDER " << result.visit_order.size();
  for (const auto& id : result.visit_order) {
    std::cout << " " << id;
  }
  std::cout << "\n";

  return 0;
}
